// File: services/youtube.js
import ytsr from 'ytsr';
import NodeCache from 'node-cache';

// Gunakan memory cache yang efisien
const cache = new NodeCache({ 
  stdTTL: 3600, // 1 jam default TTL
  checkperiod: 600, // Cek item kedaluwarsa setiap 10 menit
  useClones: false // Jangan clone data untuk performa
});

// Default search configuration
const DEFAULT_SEARCH_CONFIG = {
  limit: 10,
  maxRetries: 2,
  minDuration: 0,
  maxDuration: 600,
  filterLive: true,
  includeMetadata: true,
  cacheResults: true,
  prefetchRelated: true,
  timeout: 15000 // 15 detik timeout, lebih lama dari sebelumnya
};

// Pre-compile regex pattern
const musicRegex = /music/i;

// Main search function
async function searchVideos(query, options = {}) {
  if (!query || typeof query !== 'string') {
    throw new Error('Search query must be a string.');
  }

  const config = { ...DEFAULT_SEARCH_CONFIG, ...options };
  
  // Normalize query
  const searchQuery = musicRegex.test(query) ? query : `${query} music`;
  const cacheKey = `yt_${searchQuery.toLowerCase().replace(/\s+/g, '_')}_${config.limit}`;
  
  // Coba ambil dari cache
  if (config.cacheResults) {
    const cachedResult = cache.get(cacheKey);
    if (cachedResult) {
      console.log(`Cache hit for "${searchQuery}"`);
      return cachedResult;
    }
  }
  
  console.log(`Starting search for "${searchQuery}" with timeout: ${config.timeout}ms`);
  
  // Tracking untuk retry
  let attempts = 0;
  let lastError = null;
  
  while (attempts < config.maxRetries) {
    try {
      console.log(`Attempt ${attempts + 1} for "${searchQuery}"`);
      
      // Batasi opsi pencarian
      const searchOptions = {
        limit: Math.min(config.limit + 5, 30),
        safeSearch: true,
        gl: 'ID'
      };
      
      // Gunakan Promise dengan timeout lebih panjang
      const searchPromise = new Promise((resolve, reject) => {
        let timeoutId = null;
        
        // Buat timeout promise
        const timeoutPromise = new Promise((_, timeoutReject) => {
          timeoutId = setTimeout(() => {
            timeoutReject(new Error(`Search timeout after ${config.timeout}ms`));
          }, config.timeout);
        });
        
        // Jalankan pencarian ytsr
        ytsr(searchQuery, searchOptions)
          .then(result => {
            clearTimeout(timeoutId);
            resolve(result);
          })
          .catch(err => {
            clearTimeout(timeoutId);
            reject(err);
          });
          
        // Race antara pencarian dan timeout
        Promise.race([timeoutPromise, ytsr(searchQuery, searchOptions)])
          .then(resolve)
          .catch(reject);
      });
      
      // Tunggu hasil
      const results = await searchPromise;
      
      // Jika tidak ada hasil
      if (!results?.items?.length) {
        throw new Error('No results returned from search');
      }
      
      console.log(`Got ${results.items.length} raw results for "${searchQuery}"`);
      
      // Proses hasil
      const validResults = [];
      
      // Iterasi cepat
      for (let i = 0; i < results.items.length; i++) {
        const item = results.items[i];
        
        // Validasi dasar
        if (!item || 
            !item.type || 
            !item.title || 
            !item.url || 
            (item.type !== 'video' && item.type !== 'shortVideo') ||
            (config.filterLive && item.isLive)) {
          continue;
        }
        
        // Periksa durasi
        if (item.duration) {
          const duration = parseDuration(item.duration);
          if (duration < config.minDuration || duration > config.maxDuration) {
            continue;
          }
        }
        
        // Format hasil
        validResults.push(createResultObject(item, validResults.length, config.includeMetadata));
        
        // Stop setelah mendapat cukup hasil
        if (validResults.length >= config.limit) break;
      }
      
      console.log(`Got ${validResults.length} valid results for "${searchQuery}"`);
      
      // Jika tidak ada hasil valid
      if (validResults.length === 0) {
        throw new Error('No valid results found after filtering');
      }
      
      // Siapkan hasil
      const formattedResult = {
        success: true,
        query: searchQuery,
        totalResults: validResults.length,
        results: validResults
      };
      
      // Simpan ke cache
      if (config.cacheResults) {
        cache.set(cacheKey, formattedResult);
        
        // Optional: Pre-fetch related queries
        if (config.prefetchRelated && validResults.length > 0) {
          setTimeout(() => {
            prefetchRelatedQueries(searchQuery, validResults, config);
          }, 100);
        }
      }
      
      return formattedResult;
      
    } catch (error) {
      console.error(`Search attempt ${attempts + 1} failed:`, error.message);
      lastError = error;
      attempts++;
      
      // Jika masih ada retry
      if (attempts < config.maxRetries) {
        // Exponential backoff
        const delayMs = 1000 * Math.pow(2, attempts);
        console.log(`Waiting ${delayMs}ms before next attempt...`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
  }
  
  // Jika semua attempts gagal
  console.error(`All ${config.maxRetries} search attempts failed for "${searchQuery}"`);
  return {
    success: false,
    error: lastError?.message || 'Search failed after multiple attempts',
    query: searchQuery
  };
}

// Format hasil
function createResultObject(item, index, includeMetadata) {
  // Buat objek dasar
  const result = {
    id: index + 1,
    title: item.title,
    url: item.url,
    thumbnail: item.thumbnails?.[0]?.url || null,
    duration: item.duration || 'N/A'
  };
  
  // Tambahkan metadata jika diperlukan
  if (includeMetadata) {
    result.author = item.author?.name || 'Unknown';
    result.authorUrl = item.author?.url || null;
    result.views = item.views ? formatViews(item.views) : '';
    result.uploadedAt = item.uploadedAt || '';
    result.durationInSeconds = item.duration ? parseDuration(item.duration) : 0;
    
    // Tambahkan deskripsi singkat jika ada
    if (item.description) {
      result.description = item.description.slice(0, 100) + (item.description.length > 100 ? '...' : '');
    }
  }
  
  return result;
}

// Parse durasi dengan cepat
function parseDuration(str) {
  if (!str || typeof str !== 'string') return 0;
  
  const parts = str.split(':');
  const len = parts.length;
  
  if (len === 2) {
    return ((parts[0]|0) * 60) + (parts[1]|0);
  } else if (len === 3) {
    return ((parts[0]|0) * 3600) + ((parts[1]|0) * 60) + (parts[2]|0);
  }
  
  return 0;
}

// Format view 
function formatViews(views) {
  if (!views) return '';
  const num = typeof views === 'number' ? views : parseInt(views, 10);
  if (num >= 1000000) return `${(num/1000000).toFixed(1)}M`;
  if (num >= 1000) return `${(num/1000).toFixed(1)}K`;
  return num.toString();
}

// Prefetch related queries
function prefetchRelatedQueries(query, results, config) {
  // Cari query terkait berdasarkan judul
  const relatedQueries = new Set();
  
  // Extract keywords dari judul
  results.slice(0, 2).forEach(result => {
    const words = result.title.split(' ')
      .filter(word => word.length > 3)
      .slice(0, 2);
    
    if (words.length >= 2) {
      relatedQueries.add(`${words[0]} ${words[1]} music`);
    }
  });
  
  // Prefetch query terkait dengan priority rendah
  [...relatedQueries].forEach(relatedQuery => {
    if (relatedQuery !== query) {
      setTimeout(() => {
        searchVideos(relatedQuery, { 
          limit: 5, 
          includeMetadata: false,
          prefetchRelated: false,
          timeout: config.timeout // Gunakan timeout yang sama
        }).catch(() => {}); // Abaikan error pada prefetch
      }, 2000 + Math.random() * 3000);
    }
  });
}

// Fungsi untuk membersihkan cache
function clearSearchCache() {
  cache.flushAll();
  return { success: true, message: 'Cache cleared' };
}

// Fungsi untuk mendapatkan statistik cache
function getCacheStats() {
  return {
    keys: cache.keys().length,
    hits: cache.getStats().hits,
    misses: cache.getStats().misses,
    ksize: cache.getStats().ksize,
    vsize: cache.getStats().vsize
  };
}

export {
  searchVideos,
  clearSearchCache,
  getCacheStats,
  DEFAULT_SEARCH_CONFIG
};