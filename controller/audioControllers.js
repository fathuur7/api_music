// Import additional modules for process monitoring
import ytdl from 'ytdl-core';
import path from 'path';
import Audio from '../models/audio.js';
import os from 'os';
import fs from 'fs';
import { v2 as cloudinary } from 'cloudinary';
import dotenv from 'dotenv';
import axios from 'axios';
import { promisify } from 'util';
// New imports for process monitoring
import { EventEmitter } from 'events';
import crypto from 'crypto';

dotenv.config();

// Global process monitoring system
const processMonitor = new EventEmitter();
// Store process statuses in memory (or use Redis in production)
const processRegistry = new Map();

// Configure Cloudinary
cloudinary.config({ 
  cloud_name: process.env.CLOUD_NAME, 
  api_key: process.env.API_KEY, 
  api_secret: process.env.API_SECRET,
  secure: true
});

// Use OS temp directory which is writable even in serverless environments
const getTempFilePath = (filename) => {
  return path.join(os.tmpdir(), filename);
};

// Helper function to upload file to Cloudinary
const uploadToCloudinary = async (filePath, folder = 'youtube-audios') => {
  console.log(`[Cloudinary] Beginning upload of ${filePath}`);
  console.log(`[Cloudinary] File exists: ${fs.existsSync(filePath)}`);
  console.log(`[Cloudinary] File size: ${fs.statSync(filePath).size} bytes`);
  
  return new Promise((resolve, reject) => {
    cloudinary.config({
      timeout: 120000 // 2 minute timeout for uploads
    });
    
    cloudinary.uploader.upload(
      filePath, 
      { 
        resource_type: 'auto',
        folder: folder,
        use_filename: true
      }, 
      (error, result) => {
        if (error) {
          console.error("[Cloudinary] Upload failed:", error);
          reject(error);
        } else {
          console.log("[Cloudinary] Upload successful:", {
            url: result.secure_url,
            publicId: result.public_id,
            size: result.bytes
          });
          resolve(result);
        }
      }
    );
  });
};

/// Enhanced keepAlive function with longer timeout and better monitoring
const keepAlive = async (processId, maxTime = 600000) => { // Increased to 10 minutes
  let elapsed = 0;
  const interval = 15000; // 15 second ping
  
  // Register process in the registry with more detailed info
  if (!processRegistry.has(processId)) {
    processRegistry.set(processId, {
      id: processId,
      startTime: Date.now(),
      lastUpdate: Date.now(),
      status: 'initialized',
      progress: 0,
      logs: ['Process initialized'],
      retries: 0,
      downloadedBytes: 0,
      totalBytes: 0
    });
  }
  
  const pingInterval = setInterval(() => {
    elapsed += interval;
    
    // Keep serverless function warm
    const currentTime = Date.now();
    const process = processRegistry.get(processId);
    
    if (!process || process.status === 'completed' || process.status === 'failed') {
      clearInterval(pingInterval);
      return;
    }
    
    // Update last ping time
    process.lastUpdate = currentTime;
    process.logs.push(`[KeepAlive] Process running for ${elapsed/1000}s`);
    processRegistry.set(processId, process);
    
    // Emit status update for SSE clients with more details
    processMonitor.emit(`status-${processId}`, {
      id: processId,
      elapsed: elapsed,
      status: process.status,
      progress: process.progress,
      lastUpdate: currentTime,
      elapsedFormatted: `${Math.floor(elapsed/60000)}m ${Math.floor((elapsed%60000)/1000)}s`,
      downloadStats: process.downloadedBytes > 0 ? {
        downloaded: process.downloadedBytes,
        total: process.totalBytes,
        percentage: process.totalBytes > 0 ? 
          Math.round((process.downloadedBytes / process.totalBytes) * 100) : 0,
        formattedDownloaded: `${(process.downloadedBytes/(1024*1024)).toFixed(2)}MB`,
        formattedTotal: process.totalBytes > 0 ? 
          `${(process.totalBytes/(1024*1024)).toFixed(2)}MB` : 'Unknown'
      } : null
    });
    
    // Check if max time reached
    if (elapsed >= maxTime) {
      clearInterval(pingInterval);
      
      // Log timeout
      process.status = 'failed';
      process.logs.push(`[KeepAlive] Process timed out after ${maxTime/1000}s`);
      processRegistry.set(processId, process);
      
      processMonitor.emit(`status-${processId}`, {
        id: processId,
        status: 'failed',
        error: `Process timed out after ${Math.floor(maxTime/60000)} minutes`,
        lastUpdate: currentTime
      });
    }
  }, interval);
  
  return pingInterval;
};

// Enhanced update process status function to store more details
const updateProcessStatus = (processId, status, progress = null, log = null, extraData = {}) => {
  if (!processRegistry.has(processId)) {
    return false;
  }
  
  const process = processRegistry.get(processId);
  const currentTime = Date.now();
  
  if (status) process.status = status;
  if (progress !== null) process.progress = progress;
  if (log) process.logs.push(`[${new Date().toISOString()}] ${log}`);
  
  // Update any extra data like downloaded bytes, total bytes, etc.
  Object.keys(extraData).forEach(key => {
    process[key] = extraData[key];
  });
  
  process.lastUpdate = currentTime;
  processRegistry.set(processId, process);
  
  // Calculate elapsed time
  const elapsed = currentTime - process.startTime;
  const elapsedFormatted = `${Math.floor(elapsed/60000)}m ${Math.floor((elapsed%60000)/1000)}s`;
  
  // Add download stats if available
  let downloadStats = null;
  if (process.downloadedBytes > 0) {
    downloadStats = {
      downloaded: process.downloadedBytes,
      total: process.totalBytes,
      percentage: process.totalBytes > 0 ? 
        Math.round((process.downloadedBytes / process.totalBytes) * 100) : 0,
      formattedDownloaded: `${(process.downloadedBytes/(1024*1024)).toFixed(2)}MB`,
      formattedTotal: process.totalBytes > 0 ? 
        `${(process.totalBytes/(1024*1024)).toFixed(2)}MB` : 'Unknown'
    };
  }
  
  // Emit event for SSE listeners with more details
  processMonitor.emit(`status-${processId}`, {
    id: processId,
    status: process.status,
    progress: process.progress,
    lastUpdate: currentTime,
    message: log,
    elapsed: elapsed,
    elapsedFormatted: elapsedFormatted,
    downloadStats: downloadStats,
    retries: process.retries || 0
  });
  
  return true;
};

// Update database with retry mechanism
const updateDatabaseWithRetry = async (audioId, updateData, maxRetries = 3) => {
  let retries = 0;
  while (retries < maxRetries) {
    try {
      console.log(`[DB] Attempt ${retries + 1} to update audio ${audioId} with:`, updateData);
      
      const updatedAudio = await Audio.findByIdAndUpdate(
        audioId, 
        updateData, 
        { new: true, runValidators: true }
      );
      
      if (!updatedAudio) {
        throw new Error(`Audio with ID ${audioId} not found`);
      }
      
      console.log(`[DB] Update successful for ${audioId}`);
      return updatedAudio;
    } catch (error) {
      retries++;
      console.error(`[DB] Update attempt ${retries} failed for ${audioId}:`, error);
      
      // Add specific error handling for common MongoDB errors
      if (error.name === 'ValidationError') {
        console.error('[DB] Validation error details:', error.errors);
      }
      
      // Wait before retry (exponential backoff)
      await new Promise(resolve => setTimeout(resolve, 1000 * retries));
    }
  }
  throw new Error(`Failed to update database after ${maxRetries} attempts for ID ${audioId}`);
};

// Extract video ID from YouTube URL
const extractVideoId = (url) => {
  // Patterns to extract YouTube video ID from various URL formats
  const patterns = [
    /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/i,
    /^([^"&?\/\s]{11})$/i
  ];
  
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match && match[1]) {
      return match[1];
    }
  }
  
  // Try extracting ID by splitting URL
  if (url.includes('v=')) {
    return url.split('v=')[1]?.split('&')[0];
  } else if (url.includes('youtu.be/')) {
    return url.split('youtu.be/')[1]?.split('?')[0];
  }
  
  return null;
};
// Enhanced function to get video info with better error handling and retry logic
const getVideoInfo = async (videoUrl, maxRetries = 3) => {
  let attempts = 0;
  let lastError = null;
  
  while (attempts < maxRetries) {
    attempts++;
    
    try {
      const videoId = extractVideoId(videoUrl);
      
      if (!videoId) throw new Error('URL YouTube tidak valid');
      
      // Try different approaches in sequence
      const approaches = [
        // Approach 1: YouTube oEmbed API (fastest but limited info)
        async () => {
          const response = await axios.get(`https://www.youtube.com/oembed?url=${videoUrl}&format=json`, {
            timeout: 8000,
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
          });
          
          return {
            title: response.data.title,
            thumbnail: `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`,
            author: response.data.author_name,
            videoId
          };
        },
        
        // Approach 2: Direct ytdl-core with timeout
        async () => {
          const info = await Promise.race([
            ytdl.getInfo(videoId),
            new Promise((_, reject) => 
              setTimeout(() => reject(new Error('ytdl-core timeout')), 15000)
            )
          ]);
          
          return {
            title: info.videoDetails.title,
            thumbnail: info.videoDetails.thumbnails[0].url,
            duration: info.videoDetails.lengthSeconds,
            durationInSeconds: parseInt(info.videoDetails.lengthSeconds),
            author: info.videoDetails.author.name,
            formats: info.formats,
            videoId
          };
        },
        
        // Approach 3: Simple fallback with basic info
        async () => {
          return {
            title: `YouTube Audio - ${videoId}`,
            thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
            author: 'Unknown',
            videoId
          };
        }
      ];
      
      // Try each approach in sequence until one succeeds
      for (const approach of approaches) {
        try {
          return await approach();
        } catch (approachError) {
          console.log(`Video info approach failed: ${approachError.message}`);
          // Continue to next approach
          lastError = approachError;
        }
      }
      
      // If we get here, all approaches failed in this attempt
      throw new Error(lastError?.message || 'All video info retrieval methods failed');
      
    } catch (error) {
      console.error(`Video info attempt ${attempts} failed: ${error.message}`);
      lastError = error;
      
      // Wait before retry (exponential backoff)
      if (attempts < maxRetries) {
        const backoffTime = 1000 * Math.pow(2, attempts - 1); // 1s, 2s, 4s...
        await new Promise(resolve => setTimeout(resolve, backoffTime));
      }
    }
  }
  
  // If we reach here, all attempts failed
  console.error("All video info retrieval attempts failed");
  throw new Error(`Failed to get video information after ${maxRetries} attempts. Last error: ${lastError?.message}`);
};

// Di// Enhanced direct download function with better timeout and error handling
const directAudioDownload = async (url, outputPath, processId) => {
  updateProcessStatus(processId, 'downloading', 20, "Attempting direct audio download");
  
  try {
    const response = await axios({
      method: 'GET',
      url,
      responseType: 'stream',
      timeout: 180000, // 3 minutes timeout
      maxContentLength: 500 * 1024 * 1024, // Allow up to 500MB files
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': '*/*',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Range': 'bytes=0-'  // Support resumable downloads
      }
    });
    
    let downloadedBytes = 0;
    const totalBytes = parseInt(response.headers['content-length']) || 0;
    
    return new Promise((resolve, reject) => {
      // Set timeout based on expected download time
      const estimatedTimePerMB = 2000; // 2 seconds per MB
      const fileSizeMB = totalBytes / (1024 * 1024);
      const dynamicTimeout = Math.max(
        60000, // Minimum 1 minute
        Math.min(300000, Math.ceil(fileSizeMB * estimatedTimePerMB)) // Max 5 minutes
      );
      
      const downloadTimeout = setTimeout(() => {
        updateProcessStatus(processId, 'error', null, 
          `Direct download timeout after ${dynamicTimeout/1000} seconds`);
        reject(new Error(`Direct download timeout after ${dynamicTimeout/1000} seconds`));
      }, dynamicTimeout);
      
      const writer = fs.createWriteStream(outputPath);
      
      // Set up progress tracking
      if (totalBytes > 0) {
        response.data.on('data', (chunk) => {
          downloadedBytes += chunk.length;
          const progress = Math.min(40, 20 + Math.floor((downloadedBytes / totalBytes) * 20));
          const percentage = Math.round((downloadedBytes / totalBytes) * 100);
          
          // Update progress less frequently to reduce overhead
          if (percentage % 5 === 0 || percentage >= 99) {
            updateProcessStatus(processId, 'downloading', progress, 
              `Direct download: ${percentage}% (${(downloadedBytes/(1024*1024)).toFixed(2)}MB/${(totalBytes/(1024*1024)).toFixed(2)}MB)`);
          }
        });
      }
      
      response.data.pipe(writer);
      
      writer.on('finish', () => {
        clearTimeout(downloadTimeout);
        const fileSize = fs.statSync(outputPath).size;
        updateProcessStatus(processId, 'processing', 40, 
          `Direct download successful: ${(fileSize/(1024*1024)).toFixed(2)}MB downloaded`);
        resolve(true);
      });
      
      writer.on('error', (err) => {
        clearTimeout(downloadTimeout);
        updateProcessStatus(processId, 'error', null, `Error writing file: ${err.message}`);
        reject(err);
      });
      
      // Handle connection errors
      response.data.on('error', (err) => {
        clearTimeout(downloadTimeout);
        updateProcessStatus(processId, 'error', null, `Connection error: ${err.message}`);
        reject(err);
      });
    });
  } catch (error) {
    updateProcessStatus(processId, 'error', null, 
      `Failed to initiate direct download: ${error.message}`);
    throw error;
  }
};

// Enhanced download function with better fallback mechanisms
const downloadAudio = async (videoUrl, videoInfo, outputPath, processId) => {
  updateProcessStatus(processId, 'started', 10, "Starting audio download process");
  
  // First try: Direct audio URL from formats (if available)
  if (videoInfo.formats && videoInfo.formats.length > 0) {
    // Find audio formats and sort by quality
    const audioFormats = videoInfo.formats
      .filter(f => f.mimeType && f.mimeType.includes('audio/'))
      .sort((a, b) => (b.audioBitrate || 0) - (a.audioBitrate || 0));
    
    // If we have audio formats, use the best one
    if (audioFormats.length > 0 && audioFormats[0].url) {
      try {
        updateProcessStatus(processId, 'downloading', 15, "Direct audio URL found, attempting download");
        await directAudioDownload(audioFormats[0].url, outputPath, processId);
        
        // Verify the file exists and has content
        if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) {
          return true;
        }
      } catch (directError) {
        updateProcessStatus(processId, 'warning', null, `Direct download failed: ${directError.message}, trying alternative methods`);
        // Continue to next method
      }
    }
  }
  
  // Second try: Try all available formats sequentially
  if (videoInfo.formats && videoInfo.formats.length > 0) {
    // Try multiple formats (audio and video) in sequence
    const allFormats = [...videoInfo.formats].sort((a, b) => {
      // Prioritize audio formats first, then by bitrate/quality
      const aIsAudio = a.mimeType && a.mimeType.includes('audio/');
      const bIsAudio = b.mimeType && b.mimeType.includes('audio/');
      
      if (aIsAudio && !bIsAudio) return -1;
      if (!aIsAudio && bIsAudio) return 1;
      
      // Then by bitrate for audio or quality for video
      return (b.audioBitrate || b.quality_label || 0) - (a.audioBitrate || a.quality_label || 0);
    });
    
    // Try up to 3 formats
    const formatsToTry = allFormats.slice(0, Math.min(3, allFormats.length));
    
    for (let i = 0; i < formatsToTry.length; i++) {
      const format = formatsToTry[i];
      if (format.url) {
        try {
          updateProcessStatus(processId, 'downloading', 15, 
            `Trying format ${i+1}/${formatsToTry.length}: ${format.mimeType || 'unknown'}`);
          
          await directAudioDownload(format.url, outputPath, processId);
          
          // Verify the file exists and has content
          if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) {
            return true;
          }
        } catch (formatError) {
          updateProcessStatus(processId, 'warning', null, 
            `Format ${i+1} download failed: ${formatError.message}`);
          // Continue to next format
        }
      }
    }
  }
  
  // Third try: Enhanced ytdl-core with multiple configurations
  try {
    updateProcessStatus(processId, 'downloading', 15, "Trying ytdl-core with multiple configurations");
    
    // Try with different configurations
    const configs = [
      { 
        quality: 'highestaudio', 
        filter: 'audioonly',
        requestOptions: { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' } }
      },
      { 
        quality: 'lowestaudio', 
        filter: 'audioonly',
        requestOptions: { headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36' } }
      },
      { 
        // Try without audio filter as fallback
        quality: 'highest', 
        requestOptions: { headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15' } }
      }
    ];
    
    for (let i = 0; i < configs.length; i++) {
      try {
        updateProcessStatus(processId, 'downloading', 15, `Trying ytdl config ${i+1}/${configs.length}`);
        await downloadWithConfig(videoUrl, outputPath, configs[i], processId);
        
        // Verify the file exists and has content
        if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) {
          return true;
        }
      } catch (configError) {
        updateProcessStatus(processId, 'warning', null, 
          `ytdl config ${i+1} failed: ${configError.message}`);
        // Continue to next config
      }
    }
    
    // Final attempt with our enhanced retry download function
    return await downloadWithRetry(videoUrl, videoInfo, outputPath, processId, 3);
    
  } catch (allAttemptsError) {
    updateProcessStatus(processId, 'failed', null, `All download methods failed: ${allAttemptsError.message}`);
    throw new Error("All download methods failed");
  }
};

// Helper function to download with a specific config
const downloadWithConfig = async (videoUrl, outputPath, config, processId) => {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Download timeout after 120 seconds with config`));
    }, 120000);
    
    try {
      const stream = ytdl(videoUrl, {
        highWaterMark: 1 << 25, // 32MB buffer
        ...config
      });
      
      const writer = fs.createWriteStream(outputPath);
      
      stream.on('progress', (_, downloaded, total) => {
        if (total > 0) {
          const progress = Math.min(40, 15 + Math.floor((downloaded / total) * 25));
          updateProcessStatus(processId, 'downloading', progress, 
            `Downloading: ${Math.round((downloaded / total) * 100)}%`);
        }
      });
      
      stream.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
      
      writer.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
      
      writer.on('finish', () => {
        clearTimeout(timeout);
        // Check if file has content
        const stats = fs.statSync(outputPath);
        if (stats.size > 0) {
          resolve(true);
        } else {
          reject(new Error("Generated file is empty"));
        }
      });
      
      stream.pipe(writer);
    } catch (err) {
      clearTimeout(timeout);
      reject(err);
    }
  });
};

// Add more robust error handling to directAudioDownload
const directAudioDownload = async (url, outputPath, processId) => {
  updateProcessStatus(processId, 'downloading', 20, "Attempting direct audio download");
  
  try {
    const response = await axios({
      method: 'GET',
      url,
      responseType: 'stream',
      timeout: 240000, // 4 minutes timeout (increased from 3)
      maxContentLength: 500 * 1024 * 1024, // Allow up to 500MB files
      headers: {
        // Use multiple User-Agent options to avoid detection
        'User-Agent': [
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
          'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/92.0.4515.107 Safari/537.36',
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Safari/605.1.15',
          'Mozilla/5.0 (iPhone; CPU iPhone OS 14_7_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.1.2 Mobile/15E148 Safari/604.1'
        ][Math.floor(Math.random() * 4)],
        'Accept': '*/*',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Range': 'bytes=0-'  // Support resumable downloads
      }
    });
    
    let downloadedBytes = 0;
    const totalBytes = parseInt(response.headers['content-length']) || 0;
    
    return new Promise((resolve, reject) => {
      // Set timeout based on expected download time
      const estimatedTimePerMB = 2000; // 2 seconds per MB
      const fileSizeMB = totalBytes / (1024 * 1024);
      const dynamicTimeout = Math.max(
        120000, // Minimum 2 minutes (increased from 1)
        Math.min(600000, Math.ceil(fileSizeMB * estimatedTimePerMB)) // Max 10 minutes (increased from 5)
      );
      
      const downloadTimeout = setTimeout(() => {
        updateProcessStatus(processId, 'error', null, 
          `Direct download timeout after ${dynamicTimeout/1000} seconds`);
        reject(new Error(`Direct download timeout after ${dynamicTimeout/1000} seconds`));
      }, dynamicTimeout);
      
      const writer = fs.createWriteStream(outputPath);
      
      // Set up progress tracking
      if (totalBytes > 0) {
        response.data.on('data', (chunk) => {
          downloadedBytes += chunk.length;
          const progress = Math.min(40, 20 + Math.floor((downloadedBytes / totalBytes) * 20));
          const percentage = Math.round((downloadedBytes / totalBytes) * 100);
          
          // Update progress less frequently to reduce overhead
          if (percentage % 5 === 0 || percentage >= 99) {
            updateProcessStatus(processId, 'downloading', progress, 
              `Direct download: ${percentage}% (${(downloadedBytes/(1024*1024)).toFixed(2)}MB/${(totalBytes/(1024*1024)).toFixed(2)}MB)`);
          }
          
          // Update extra data for better monitoring
          updateProcessStatus(processId, null, null, null, {
            downloadedBytes: downloadedBytes,
            totalBytes: totalBytes
          });
        });
      }
      
      response.data.pipe(writer);
      
      writer.on('finish', () => {
        clearTimeout(downloadTimeout);
        const fileSize = fs.statSync(outputPath).size;
        updateProcessStatus(processId, 'processing', 40, 
          `Direct download successful: ${(fileSize/(1024*1024)).toFixed(2)}MB downloaded`);
        resolve(true);
      });
      
      writer.on('error', (err) => {
        clearTimeout(downloadTimeout);
        updateProcessStatus(processId, 'error', null, `Error writing file: ${err.message}`);
        reject(err);
      });
      
      // Handle connection errors
      response.data.on('error', (err) => {
        clearTimeout(downloadTimeout);
        updateProcessStatus(processId, 'error', null, `Connection error: ${err.message}`);
        reject(err);
      });
    });
  } catch (error) {
    updateProcessStatus(processId, 'error', null, 
      `Failed to initiate direct download: ${error.message}`);
    throw error;
  }
};

// Enhanced downloadWithRetry function
const downloadWithRetry = async (videoUrl, videoInfo, outputPath, processId, maxRetries = 3) => {
  let attempts = 0;
  let lastError = null;

  while (attempts < maxRetries) {
    attempts++;
    try {
      updateProcessStatus(processId, 'downloading', 15 + (attempts - 1) * 5, 
        `Download attempt ${attempts} of ${maxRetries}`);
      
      // Try with different quality settings and configurations
      const options = {
        quality: attempts === 1 ? 'highestaudio' : (attempts === 2 ? 'lowestaudio' : ''),
        filter: attempts < 3 ? 'audioonly' : 'audioandvideo', // Try with video on last attempt
        highWaterMark: 1 << 25, // 32MB buffer
        requestOptions: {
          headers: {
            // Rotate User-Agents to avoid detection
            'User-Agent': [
              `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${90 + attempts}.0.0.0 Safari/537.36`,
              'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/92.0.4515.107 Safari/537.36',
              'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Safari/605.1.15'
            ][attempts - 1],
            'Accept': '*/*'
          },
          timeout: 120000 * attempts // Increase timeout with each attempt
        }
      };
      
      return new Promise((resolve, reject) => {
        // Set a timeout scaled by attempt number
        const downloadTimeout = setTimeout(() => {
          updateProcessStatus(processId, 'retrying', null, 
            `Download timeout after ${3 * attempts} minutes on attempt ${attempts}`);
          reject(new Error(`Download timeout on attempt ${attempts}`));
        }, 180000 * attempts); // 3min, 6min, 9min for respective attempts
        
        try {
          const stream = ytdl(videoUrl, options);
          const writer = fs.createWriteStream(outputPath);
          
          // Track download progress
          let downloadedBytes = 0;
          let reportedSize = 0;
          
          stream.on('progress', (_, downloaded, total) => {
            downloadedBytes = downloaded;
            reportedSize = total;
            const progress = Math.min(40, 15 + Math.floor((downloaded / total) * 25));
            updateProcessStatus(processId, 'downloading', progress, 
              `Attempt ${attempts}: ${Math.round((downloaded / total) * 100)}% complete`);
            
            // Update extra data for better monitoring
            updateProcessStatus(processId, null, null, null, {
              downloadedBytes: downloaded,
              totalBytes: total
            });
          });
          
          stream.on('error', (err) => {
            clearTimeout(downloadTimeout);
            updateProcessStatus(processId, 'error', null, 
              `Error on ytdl stream attempt ${attempts}: ${err.message}`);
            reject(err);
          });
          
          writer.on('error', (err) => {
            clearTimeout(downloadTimeout);
            updateProcessStatus(processId, 'error', null, 
              `Error writing file on attempt ${attempts}: ${err.message}`);
            reject(err);
          });
          
          writer.on('finish', () => {
            clearTimeout(downloadTimeout);
            // Check if file has content
            const stats = fs.statSync(outputPath);
            if (stats.size > 0) {
              updateProcessStatus(processId, 'processing', 40, 
                `Download successful on attempt ${attempts}`);
              resolve(true);
            } else {
              updateProcessStatus(processId, 'error', null, 
                `Generated file is empty on attempt ${attempts}`);
              reject(new Error(`Generated file is empty on attempt ${attempts}`));
            }
          });
          
          // Additional error handling
          stream.on('response', (response) => {
            if (response.statusCode >= 400) {
              clearTimeout(downloadTimeout);
              updateProcessStatus(processId, 'error', null, 
                `HTTP error ${response.statusCode} on attempt ${attempts}`);
              reject(new Error(`HTTP error ${response.statusCode}`));
            }
          });
          
          // Pipe the stream directly to file
          stream.pipe(writer);
        } catch (initError) {
          clearTimeout(downloadTimeout);
          reject(initError);
        }
      });
    } catch (error) {
      lastError = error;
      updateProcessStatus(processId, 'retrying', 15, 
        `Attempt ${attempts} failed: ${error.message}. ${attempts < maxRetries ? 'Retrying...' : 'All attempts failed.'}`);
      
      // Wait before retry (exponential backoff)
      if (attempts < maxRetries) {
        const backoffTime = 5000 * Math.pow(2, attempts - 1); // 5s, 10s, 20s...
        await new Promise(resolve => setTimeout(resolve, backoffTime));
      }
    }
  }
  
  // If we reach here, all attempts failed
  throw new Error(`All ${maxRetries} download attempts failed. Last error: ${lastError?.message}`);
};

// Add a new method to try YouTube API download via Invidious instances
const tryInvidiousDownload = async (videoId, outputPath, processId) => {
  updateProcessStatus(processId, 'downloading', 15, "Trying Invidious API download");
  
  // List of public Invidious instances to try
  const instances = [
    'https://invidious.snopyta.org',
    'https://invidious.kavin.rocks',
    'https://invidio.us',
    'https://vid.puffyan.us',
    'https://invidious.tube'
  ];
  
  for (const instance of instances) {
    try {
      updateProcessStatus(processId, 'downloading', 15, `Trying Invidious instance: ${instance}`);
      
      // Get video info from Invidious API
      const response = await axios.get(`${instance}/api/v1/videos/${videoId}`, {
        timeout: 10000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });
      
      if (response.data && response.data.adaptiveFormats) {
        // Find audio formats
        const audioFormats = response.data.adaptiveFormats.filter(f => 
          f.type && f.type.includes('audio/'));
        
        if (audioFormats.length > 0) {
          // Try to download the best audio format
          const bestAudio = audioFormats.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0];
          
          if (bestAudio.url) {
            updateProcessStatus(processId, 'downloading', 20, 
              `Found audio format via Invidious: ${bestAudio.type}`);
            
            // Download the audio
            await directAudioDownload(bestAudio.url, outputPath, processId);
            
            // Verify the file exists and has content
            if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) {
              return true;
            }
          }
        }
      }
    } catch (error) {
      updateProcessStatus(processId, 'warning', null, 
        `Invidious instance ${instance} failed: ${error.message}`);
      // Continue to next instance
    }
  }
  
  // If we reach here, all instances failed
  updateProcessStatus(processId, 'warning', null, "All Invidious instances failed");
  return false;
};

// Add this method to the main downloadAudio function before the final return/throw
// ...
// try {
//   // Try Invidious API as a last resort
//   const videoId = extractVideoId(videoUrl);
//   if (videoId) {
//     const invidiousSuccess = await tryInvidiousDownload(videoId, outputPath, processId);
//     if (invidiousSuccess) return true;
//   }
//   
//   // Final attempt with our enhanced retry download function
//   return await downloadWithRetry(videoUrl, videoInfo, outputPath, processId, 3);
// } catch (allAttemptsError) {
//   updateProcessStatus(processId, 'failed', null, `All download methods failed: ${allAttemptsError.message}`);
//   throw new Error("All download methods failed");
// }
// ...

// Main endpoint for YouTube to audio conversion
export const convertVideoToAudio = async (req, res) => {
  const { videoData } = req.body;
  
  if (!videoData || !videoData.url) {
    return res.status(400).json({ success: false, message: 'URL video tidak ditemukan' });
  }
  
  try {
    console.log("Processing request for URL:", videoData.url);
    
    // Generate a process ID for monitoring
    const processId = crypto.randomUUID();
    
    // Check if audio already exists in database
    const existingAudio = await Audio.findOne({ originalUrl: videoData.url });
    if (existingAudio) {
      console.log("Audio already available in database");
      
      // Check if the existing audio has valid URL and is complete
      if (existingAudio.audioUrl === 'pending_upload' && existingAudio.status !== 'failed') {
        console.log("Existing record found but has pending_upload status");
        
        // If more than 10 minutes old, assume it's stuck and start processing again
        const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
        if (existingAudio.createdAt < tenMinutesAgo) {
          console.log("Existing record is stale, reprocessing...");
          // Continue with processing below
        } else {
          return res.json({
            success: true,
            message: 'Audio sedang diproses',
            status: 'processing',
            processingId: existingAudio._id,
            monitoringId: processId, // Include monitoring ID
            estimatedTime: '30-60 detik'
          });
        }
      } else if (existingAudio.audioUrl !== 'pending_upload') {
        // Audio is complete, return it
        return res.json({
          success: true,
          message: 'Audio sudah tersedia',
          audio: existingAudio
        });
      }
    }

    // Extract video ID from URL
    const videoId = extractVideoId(videoData.url) || Date.now().toString();
    
    // Get video info - optimized for serverless
    console.log("Getting video info for:", videoData.url);
    updateProcessStatus(processId, 'retrieving_info', 5, "Getting video information");
    const videoInfo = await getVideoInfo(videoData.url);
    console.log("Video info obtained:", videoInfo.title);
    updateProcessStatus(processId, 'info_retrieved', 10, `Info obtained: ${videoInfo.title}`);
    
    // Create or update a DB entry to track processing status
    let processingAudio;
    if (existingAudio && existingAudio.audioUrl === 'pending_upload') {
      // Update existing record if it's stuck
      processingAudio = existingAudio;
      processingAudio.status = 'processing';
      processingAudio.monitoringId = processId; // Add monitoring ID
      await processingAudio.save();
    } else {
      // Create new record
      processingAudio = new Audio({
        title: videoInfo.title || `Audio-${videoId}`,
        originalUrl: videoData.url,
        status: 'processing',
        monitoringId: processId, // Add monitoring ID
        thumbnail: videoInfo.thumbnail || '',
        duration: videoInfo.duration || '',
        durationInSeconds: videoInfo.durationInSeconds || 0,
        artist: videoInfo.author || 'Unknown',
        // Add default values for required fields
        publicId: 'pending_upload',
        audioUrl: 'pending_upload'
      });
      
      await processingAudio.save();
      updateProcessStatus(processId, 'db_created', 15, "Database record created");
    }
    
    // For serverless environment, return early with processing status
    // This prevents timeout errors on Vercel
    res.json({
      success: true,
      message: 'Konversi video dimulai',
      status: 'processing',
      processingId: processingAudio._id,
      monitoringId: processId, // Include monitoring ID for status updates
      estimatedTime: '30-60 detik'
    });
    
    // Continue processing asynchronously (won't block response)
    processVideoAsync(videoData.url, videoInfo, processingAudio._id, processId);
    
  } catch (initialError) {
    console.error('Error converting video to audio:', initialError);
    
    // Provide more specific error message based on common problems
    let errorMessage = 'Gagal memproses video';
    let errorDetail = 'Kesalahan saat mengunduh atau memproses audio';
    let errorCode = 500;
    
    if (initialError.message.includes('410')) {
      errorMessage = 'YouTube API tidak tersedia (Error 410)';
      errorDetail = 'YouTube telah mengubah API mereka. Coba lagi nanti atau gunakan URL video lain.';
    } else if (initialError.message.includes('sign in') || initialError.message.includes('login')) {
      errorMessage = 'Video memerlukan login';
      errorDetail = 'Video ini memerlukan login YouTube dan tidak dapat diunduh.';
      errorCode = 403;
    } else if (initialError.message.includes('copyright')) {
      errorMessage = 'Masalah hak cipta';
      errorDetail = 'Video ini memiliki pembatasan hak cipta.';
      errorCode = 403;
    } else if (initialError.message.includes('private')) {
      errorMessage = 'Video bersifat privat';
      errorDetail = 'Video ini dibuat privat oleh pemiliknya dan tidak dapat diakses.';
      errorCode = 403;
    } else if (initialError.message.includes('tidak valid') || initialError.message.includes('invalid')) {
      errorMessage = 'URL YouTube tidak valid';
      errorDetail = 'Silakan periksa URL dan coba lagi.';
      errorCode = 400;
    }
    
    res.status(errorCode).json({ 
      success: false, 
      message: errorMessage, 
      error: initialError.message,
      detail: errorDetail
    });
  }
};

// Add this new function to implement retry logic for downloads
const downloadWithRetry = async (videoUrl, videoInfo, outputPath, processId, maxRetries = 3) => {
  let attempts = 0;
  let lastError = null;

  while (attempts < maxRetries) {
    attempts++;
    try {
      updateProcessStatus(processId, 'downloading', 15 + (attempts - 1) * 5, 
        `Download attempt ${attempts} of ${maxRetries}`);
      
      // Try with different quality settings depending on attempt number
      const options = {
        quality: attempts === 1 ? 'highestaudio' : (attempts === 2 ? 'lowestaudio' : 'highestaudio'),
        filter: 'audioonly',
        highWaterMark: 1 << 25, // 32MB buffer
        requestOptions: {
          headers: {
            'User-Agent': `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${90 + attempts}.0.0.0 Safari/537.36`
          },
          timeout: 60000 * attempts // Increase timeout with each attempt
        }
      };
      
      return new Promise((resolve, reject) => {
        // Set a timeout scaled by attempt number
        const downloadTimeout = setTimeout(() => {
          updateProcessStatus(processId, 'retrying', null, 
            `Download timeout after ${2 * attempts} minutes on attempt ${attempts}`);
          reject(new Error(`Download timeout on attempt ${attempts}`));
        }, 120000 * attempts); // 2min, 4min, 6min for respective attempts
        
        const stream = ytdl(videoUrl, options);
        const writer = fs.createWriteStream(outputPath);
        
        // Track download progress
        let downloadedBytes = 0;
        let reportedSize = 0;
        
        stream.on('progress', (_, downloaded, total) => {
          downloadedBytes = downloaded;
          reportedSize = total;
          const progress = Math.min(40, 15 + Math.floor((downloaded / total) * 25));
          updateProcessStatus(processId, 'downloading', progress, 
            `Attempt ${attempts}: ${Math.round((downloaded / total) * 100)}% complete`);
        });
        
        stream.on('error', (err) => {
          clearTimeout(downloadTimeout);
          updateProcessStatus(processId, 'error', null, 
            `Error on ytdl stream attempt ${attempts}: ${err.message}`);
          reject(err);
        });
        
        writer.on('error', (err) => {
          clearTimeout(downloadTimeout);
          updateProcessStatus(processId, 'error', null, 
            `Error writing file on attempt ${attempts}: ${err.message}`);
          reject(err);
        });
        
        writer.on('finish', () => {
          clearTimeout(downloadTimeout);
          // Check if file has content
          const stats = fs.statSync(outputPath);
          if (stats.size > 0) {
            updateProcessStatus(processId, 'processing', 40, 
              `Download successful on attempt ${attempts}`);
            resolve(true);
          } else {
            updateProcessStatus(processId, 'error', null, 
              `Generated file is empty on attempt ${attempts}`);
            reject(new Error(`Generated file is empty on attempt ${attempts}`));
          }
        });
        
        // Pipe the stream directly to file
        stream.pipe(writer);
      });
    } catch (error) {
      lastError = error;
      updateProcessStatus(processId, 'retrying', 15, 
        `Attempt ${attempts} failed: ${error.message}. ${attempts < maxRetries ? 'Retrying...' : 'All attempts failed.'}`);
      
      // Wait before retry (exponential backoff)
      if (attempts < maxRetries) {
        const backoffTime = 2000 * Math.pow(2, attempts - 1); // 2s, 4s, 8s...
        await new Promise(resolve => setTimeout(resolve, backoffTime));
      }
    }
  }
  
  // If we reach here, all attempts failed
  throw new Error(`All ${maxRetries} download attempts failed. Last error: ${lastError?.message}`);
};

// Now replace the downloadAudio function with this new version
const downloadAudio = async (videoUrl, videoInfo, outputPath, processId) => {
  updateProcessStatus(processId, 'started', 10, "Starting audio download process");
  
  // If we have formats from the video info, try to find a direct audio URL
  if (videoInfo.formats && videoInfo.formats.length > 0) {
    // Find audio formats and sort by quality
    const audioFormats = videoInfo.formats
      .filter(f => f.mimeType && f.mimeType.includes('audio/'))
      .sort((a, b) => (b.audioBitrate || 0) - (a.audioBitrate || 0));
    
    // If we have audio formats, use the best one
    if (audioFormats.length > 0 && audioFormats[0].url) {
      try {
        updateProcessStatus(processId, 'downloading', 15, "Direct audio URL found, attempting download");
        await directAudioDownload(audioFormats[0].url, outputPath, processId);
        
        // Verify the file exists and has content
        if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) {
          return true;
        }
      } catch (directError) {
        updateProcessStatus(processId, 'error', null, `Direct download failed: ${directError.message}`);
        // Continue to next method
      }
    }
  }
  
  // Try with our enhanced retry download function
  try {
    return await downloadWithRetry(videoUrl, videoInfo, outputPath, processId, 3);
  } catch (allAttemptsError) {
    updateProcessStatus(processId, 'failed', null, `All download methods failed: ${allAttemptsError.message}`);
    throw new Error("All download methods failed");
  }
};

// Separate function to handle async processing
const processVideoAsync = async (videoUrl, videoInfo, audioId, processId) => {
  try {
    // Set up keep-alive mechanism for serverless environments
    const keepAliveInterval = await keepAlive(processId);
    
    const videoId = extractVideoId(videoUrl) || Date.now().toString();
    // Path for temporary storage in OS temp directory
    const outputPath = getTempFilePath(`${videoId}.mp3`);
    
    updateProcessStatus(processId, 'downloading', 15, 
      `Starting download process for video ID: ${videoId}, audio ID: ${audioId}`);
    
    // Try all download methods
    await downloadAudio(videoUrl, videoInfo, outputPath, processId);
    
    // Check if file exists and has content
    if (!fs.existsSync(outputPath)) {
      updateProcessStatus(processId, 'failed', null, 'Download failed: Output file does not exist');
      throw new Error('Download failed: Output file does not exist');
    }
    
    const fileSize = fs.statSync(outputPath).size;
    if (fileSize === 0) {
      updateProcessStatus(processId, 'failed', null, 'Download failed: Output file is empty (0 bytes)');
      throw new Error('Download failed: Output file is empty (0 bytes)');
    }
    
    updateProcessStatus(processId, 'uploading', 50, 
      `Audio downloaded successfully (${fileSize} bytes), uploading to Cloudinary...`);
    
    // Upload audio file to Cloudinary with better error handling
    let cloudinaryResult;
    try {
      updateProcessStatus(processId, 'uploading', 60, "Uploading to cloud storage");
      cloudinaryResult = await uploadToCloudinary(outputPath);
      updateProcessStatus(processId, 'uploaded', 80, "Cloud upload complete");
      
      // Verify the Cloudinary result contains needed data
      if (!cloudinaryResult.secure_url || !cloudinaryResult.public_id) {
        updateProcessStatus(processId, 'failed', null, 'Cloud upload succeeded but returned incomplete data');
        throw new Error('Cloudinary upload succeeded but returned incomplete data');
      }
    } catch (cloudinaryError) {
      updateProcessStatus(processId, 'failed', null, `Cloud upload failed: ${cloudinaryError.message}`);
      throw new Error(`Cloudinary upload failed: ${cloudinaryError.message}`);
    }
    
    // Delete temporary file AFTER successful upload
    try {
      fs.unlinkSync(outputPath);
      updateProcessStatus(processId, 'cleaning', 85, "Temporary file deleted");
    } catch (deleteError) {
      updateProcessStatus(processId, 'warning', 85, `Unable to delete temp file: ${deleteError.message}`);
      // Continue despite file deletion error
    }
    
    updateProcessStatus(processId, 'finalizing', 90, "Updating audio data in database...");
    // Update the database with explicit values
    await updateDatabaseWithRetry(audioId, {
      audioUrl: cloudinaryResult.secure_url,
      publicId: cloudinaryResult.public_id,
      status: 'completed',
      monitoringId: processId
    });
    
    updateProcessStatus(processId, 'completed', 100, 
      `Audio ${audioId} successfully saved to database with URL: ${cloudinaryResult.secure_url}`);
    
    // Clear keep-alive interval
    clearInterval(keepAliveInterval);
    
  } catch (processingError) {
    console.error(`[Async] Error in async processing for audio ${audioId}:`, processingError);
    // Update process status
    updateProcessStatus(processId, 'failed', null, `Processing error: ${processingError.message}`);
    
    // Update the record with error status and detailed error message
    try {
      await updateDatabaseWithRetry(audioId, {
        status: 'failed',
        errorMessage: processingError.message
      });
    } catch (updateError) {
      console.error(`[Async] Failed to update error status for audio ${audioId}:`, updateError.message);
    }
  }
};

// Endpoint to get all stored audio
export const GetAllAudios = async (req, res) => {
  try {
    const audios = await Audio.find().sort({ createdAt: -1 });
    res.json({ success: true, audios });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      message: 'Gagal mengambil data audio', 
      at: 'getAllAudios',
      error: error.message 
    });
  }
};

// Endpoint to get audio by ID
export const GetAudioById = async (req, res) => {
  try {
    const audio = await Audio.findById(req.params.id);
    if (!audio) {
      return res.status(404).json({ success: false, message: 'Audio tidak ditemukan' });
    }
    res.json({ success: true, audio });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      message: 'Gagal mengambil data audio', 
      error: error.message,
      at: 'getAudioById'
    });
  }
};

// NEW ENDPOINT: Get process status via Server-Sent Events (SSE)
export const getProcessStatusSSE = async (req, res) => {
  const { id } = req.params;
  
  if (!id) {
    return res.status(400).json({
      success: false,
      message: 'Process ID is required'
    });
  }
  
  // Check if process exists in registry
  if (!processRegistry.has(id)) {
    // If not in memory, check database for monitoringId
    try {
      const audio = await Audio.findOne({ monitoringId: id });
      
      if (!audio) {
        return res.status(404).json({
          success: false,
          message: 'Process not found'
        });
      }
      
      // If completed or failed, just return the status
      if (audio.status === 'completed' || audio.status === 'failed') {
        return res.json({
          success: true,
          status: audio.status,
          audioId: audio._id,
          audio: audio.status === 'completed' ? audio : undefined,
          error: audio.errorMessage
        });
      }
      
      // If it's in the database but not in memory, it might have crashed
      if (audio.status === 'processing') {
        // Re-register in the monitoring system as stalled
        processRegistry.set(id, {
          id,
          startTime: audio.updatedAt || audio.createdAt,
          lastUpdate: Date.now(),
          status: 'stalled',
          progress: 0,
          logs: ['Process may have stalled or crashed']
        });
      }
    } catch (dbError) {
      console.error('Error checking database for process:', dbError);
      return res.status(500).json({
        success: false,
        message: 'Database error when checking process status',
        error: dbError.message
      });
    }
  }
  
  // Set up SSE connection
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  
  // Send initial status
  const process = processRegistry.get(id);
  res.write(`data: ${JSON.stringify({
    id,
    status: process ? process.status : 'unknown',
    progress: process ? process.progress : 0,
    lastUpdate: process ? process.lastUpdate : Date.now()
  })}\n\n`);
  
  // Set up event listener for status updates
  const statusListener = (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
    
    // If process completed or failed, end the connection
    if (data.status === 'completed' || data.status === 'failed') {
      res.end();
    }
  };
  
  // Register event listener
  processMonitor.on(`status-${id}`, statusListener);
  
  // Handle client disconnect
  res.on('close', () => {
    processMonitor.removeListener(`status-${id}`, statusListener);
  });
};

// Enhanced endpoint to check conversion status
export const checkConversionStatus = async (req, res) => {
  try {
    const { id } = req.params;
    
    const audio = await Audio.findById(id);
    if (!audio) {
      return res.status(404).json({ success: false, message: 'Audio tidak ditemukan' });
    }
    
    // If audio has a monitoring ID and is in processing status, check the process registry
    let processStatus = null;
    if (audio.monitoringId && audio.status === 'processing') {
      const process = processRegistry.get(audio.monitoringId);
      if (process) {
        processStatus = {
          progress: process.progress,
          status: process.status,
          lastUpdate: process.lastUpdate
        };
      }
    }
    
    res.json({ success: true, audio, processStatus });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      message: 'Gagal mengambil data audio', 
      error: error.message,
      at: 'checkConversionStatus'
    });
  }
};

// Endpoint to download audio by ID
export const DownloadAudioById = async (req, res) => {
  try {
    // Find audio by ID
    const audio = await Audio.findById(req.params.id);
    if (!audio) {
      return res.status(404).json({ success: false, message: 'Audio tidak ditemukan' });
    }
    
    // Check if audio is still pending
    if (audio.audioUrl === 'pending_upload') {
      return res.status(400).json({ 
        success: false, 
        message: 'Audio masih dalam proses konversi', 
        status: audio.status 
      });
    }
    
    // Check if file has failed processing
    if (audio.status === 'failed') {
      return res.status(400).json({
        success: false,
        message: 'Proses konversi gagal',
        error: audio.errorMessage || 'Kesalahan tidak diketahui'
      });
    }
    
    // For Cloudinary, we can simply redirect to the audio URL
    // Add ?fl_attachment parameter to force download
    const downloadUrl = audio.audioUrl + "?fl_attachment=true";
    
    // Log download activity
    console.log(`[Download] Audio ${audio._id} (${audio.title}) being downloaded`);
    
    // Update download count in the database
    try {
      await Audio.findByIdAndUpdate(audio._id, {
        $inc: { downloadCount: 1 }
      });
    } catch (countError) {
      console.error('Error updating download count:', countError);
      // Continue with download even if count update fails
    }
    
    res.redirect(downloadUrl);
    
  } catch (error) {
    console.error('Error downloading audio:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Gagal mendownload audio', 
      error: error.message,
      at: 'downloadAudioById'
    });
  }
};

// Function to download audio with specific format and quality
export const DownloadAudioWithOptions = async (req, res) => {
  try {
    const { id } = req.params;
    const { format = 'mp3', quality = 'high' } = req.query;
    
    // Find audio by ID
    const audio = await Audio.findById(id);
    if (!audio) {
      return res.status(404).json({ success: false, message: 'Audio tidak ditemukan' });
    }
    
    // Check if audio is still pending
    if (audio.audioUrl === 'pending_upload') {
      return res.status(400).json({ 
        success: false, 
        message: 'Audio masih dalam proses konversi', 
        status: audio.status 
      });
    }
    
    // Check if file has failed processing
    if (audio.status === 'failed') {
      return res.status(400).json({
        success: false,
        message: 'Proses konversi gagal',
        error: audio.errorMessage || 'Kesalahan tidak diketahui'
      });
    }
    
    // For now, just use the existing audio from Cloudinary
    // In a future version, you could implement format and quality conversions
    let downloadUrl = audio.audioUrl;
    
    // Get public ID for transformations
    const publicId = audio.publicId;
    
    // Log download request
    console.log(`[Download] Audio ${id} (${audio.title}) requested with format: ${format}, quality: ${quality}`);
    
    // Add format transformation parameters for Cloudinary
    if (format === 'mp3' || format === 'wav' || format === 'ogg') {
      // If we have a valid public ID, use Cloudinary's transformation API
      if (publicId && publicId !== 'pending_upload') {
        // Extract base URL without file extension
        const baseUrl = downloadUrl.substring(0, downloadUrl.lastIndexOf('.'));
        // Build URL with new format
        downloadUrl = `${baseUrl}.${format}`;
      } else {
        // Fallback for legacy records without public ID
        downloadUrl = downloadUrl.replace(/\.[^/.]+$/, `.${format}`);
      }
    }
    
    // Add quality parameters if Cloudinary supports it
    let qualityParam = '';
    if (quality === 'high') {
      qualityParam = "quality=80";
    } else if (quality === 'medium') {
      qualityParam = "quality=60";
    } else if (quality === 'low') {
      qualityParam = "quality=40";
    }
    
    // Add quality parameter to URL
    if (qualityParam) {
      downloadUrl += downloadUrl.includes('?') ? `&${qualityParam}` : `?${qualityParam}`;
    }
    
    // Add force download parameter
    downloadUrl += downloadUrl.includes('?') ? "&fl_attachment=true" : "?fl_attachment=true";
    
    // Update download count in the database
    try {
      await Audio.findByIdAndUpdate(audio._id, {
        $inc: { downloadCount: 1 }
      });
    } catch (countError) {
      console.error('Error updating download count:', countError);
      // Continue with download even if count update fails
    }
    
    res.redirect(downloadUrl);
    
  } catch (error) {
    console.error('Error with custom download:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Gagal memproses permintaan download', 
      error: error.message,
      at: 'downloadAudioWithOptions'
    });
  }
};

// Endpoint to track download progress
export const TrackDownloadProgress = async (req, res) => {
  const { id } = req.params;
  
  try {
    const audio = await Audio.findById(id);
    if (!audio) {
      return res.status(404).json({ success: false, message: 'Audio tidak ditemukan' });
    }
    
    // Check if already completed
    if (audio.status === 'completed') {
      return res.json({
        success: true,
        status: 'completed',
        progress: 100,
        audio
      });
    }
    
    // If failed, return error
    if (audio.status === 'failed') {
      return res.json({
        success: false,
        status: 'failed',
        error: audio.errorMessage || 'Konversi gagal'
      });
    }
    
    // Check if audio has a monitoring ID, if so use the SSE status monitoring
    if (audio.monitoringId) {
      // Get process from registry
      const process = processRegistry.get(audio.monitoringId);
      
      if (process) {
        return res.json({
          success: true,
          status: process.status,
          progress: process.progress || 0,
          lastUpdate: process.lastUpdate
        });
      }
    }
    
    // Fallback to SSE for real-time monitoring
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    
    // Initial status
    res.write(`data: ${JSON.stringify({ 
      id: audio._id, 
      progress: 0, 
      status: audio.status || 'processing'
    })}\n\n`);
    
    // Set up polling to check status
    const pollInterval = setInterval(async () => {
      try {
        // Get latest status from database
        const updatedAudio = await Audio.findById(id);
        
        if (!updatedAudio) {
          clearInterval(pollInterval);
          res.write(`data: ${JSON.stringify({ 
            error: 'Audio not found', 
            status: 'failed'
          })}\n\n`);
          return res.end();
        }
        
        if (updatedAudio.status === 'completed') {
          // If completed, send 100% and end
          res.write(`data: ${JSON.stringify({ 
            id: updatedAudio._id, 
            progress: 100, 
            status: 'completed',
            audio: updatedAudio
          })}\n\n`);
          clearInterval(pollInterval);
          return res.end();
        } else if (updatedAudio.status === 'failed') {
          // If failed, send error and end
          res.write(`data: ${JSON.stringify({ 
            id: updatedAudio._id, 
            status: 'failed',
            error: updatedAudio.errorMessage || 'Konversi gagal'
          })}\n\n`);
          clearInterval(pollInterval);
          return res.end();
        } else {
          // If still processing, send progress update
          // Check if there's a monitoring ID that we can use
          if (updatedAudio.monitoringId) {
            const process = processRegistry.get(updatedAudio.monitoringId);
            if (process) {
              res.write(`data: ${JSON.stringify({ 
                id: updatedAudio._id, 
                progress: process.progress || 0, 
                status: process.status || 'processing'
              })}\n\n`);
              return;
            }
          }
          
          // Fallback to simulated progress based on time
          const elapsedTime = (Date.now() - updatedAudio.createdAt) / 1000; // seconds
          const estimatedProgress = Math.min(95, Math.floor(elapsedTime / 0.5));
          
          res.write(`data: ${JSON.stringify({ 
            id: updatedAudio._id, 
            progress: estimatedProgress, 
            status: 'processing'
          })}\n\n`);
        }
      } catch (error) {
        console.error('Error in progress polling:', error);
        clearInterval(pollInterval);
        res.write(`data: ${JSON.stringify({ 
          error: error.message, 
          status: 'failed'
        })}\n\n`);
        res.end();
      }
    }, 2000); // Poll every 2 seconds
    
    // Handle client disconnect
    res.on('close', () => {
      clearInterval(pollInterval);
    });
    
  } catch (error) {
    console.error('Error tracking download:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Gagal melacak progress download', 
      error: error.message,
      at: 'trackDownloadProgress'
    });
  }
};

// Function to fix stuck processing records manually
export const fixStuckProcessingRecord = async (req, res) => {
  try {
    const { id, cloudinaryUrl, publicId } = req.body;
    
    if (!id || !cloudinaryUrl || !publicId) {
      return res.status(400).json({ 
        success: false, 
        message: 'Parameter wajib tidak ditemukan',
        required: ['id', 'cloudinaryUrl', 'publicId']
      });
    }
    
    const audio = await Audio.findById(id);
    if (!audio) {
      return res.status(404).json({ 
        success: false, 
        message: 'Audio tidak ditemukan' 
      });
    }
    
    // Update the record with retry logic
    try {
      const updatedAudio = await Audio.findByIdAndUpdate(
        id,
        {
          audioUrl: cloudinaryUrl,
          publicId: publicId,
          status: 'completed',
          updatedAt: new Date()
        },
        { new: true }
      );
      
      console.log(`[Admin] Fixed stuck record ${id} with URL: ${cloudinaryUrl}`);
      
      res.json({
        success: true,
        message: 'Audio berhasil diperbarui',
        audio: updatedAudio
      });
    } catch (updateError) {
      console.error(`Error updating audio ${id}:`, updateError);
      res.status(500).json({
        success: false,
        message: 'Database update failed',
        error: updateError.message
      });
    }
  } catch (error) {
    console.error('Error fixing stuck record:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Gagal memperbaiki rekaman audio', 
      error: error.message 
    });
  }
};