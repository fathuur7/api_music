// test-ytsr.js
import ytsr from 'ytsr';

async function testYtsr() {
  try {
    console.log('Testing ytsr...');
    const results = await ytsr('test', { limit: 5 });
    console.log('Search successful!');
    console.log(`Found ${results.items.length} items`);
    console.log('First item:', results.items[0]);
    return true;
  } catch (error) {
    console.error('ytsr test failed:', error);
    return false;
  }
}

testYtsr()
  .then(success => {
    console.log(`Test ${success ? 'PASSED' : 'FAILED'}`);
    process.exit(success ? 0 : 1);
  });import ytsr from 'ytsr';

  async function testYtsr(query = 'test', options = { limit: 5 }) {
    try {
      console.log(`Testing ytsr with query: "${query}"...`);
      
      // Measure execution time
      const startTime = process.hrtime();
      
      // 1. Tambahkan parameter type untuk filter hasil
      // Contoh type: 'video', 'channel', 'playlist', etc.
      const searchOptions = {
        ...options,
        type: 'video', // Filter hanya video untuk hasil lebih cepat
      };
      
      // 2. Gunakan pagination untuk hasil lebih cepat
      const filters = await ytsr.getFilters(query);
      const filter = filters.get('Type').get('Video');
      
      // 3. Gunakan pagination ID daripada search query langsung
      const firstResults = await ytsr(filter.url, { pages: 1 });
      
      // Measure time taken
      const endTime = process.hrtime(startTime);
      const executionTime = (endTime[0] * 1000 + endTime[1] / 1000000).toFixed(2);
      
      console.log('Search successful!');
      console.log(`Found ${firstResults.items.length} items`);
      console.log(`Execution time: ${executionTime}ms`);
      
      if (firstResults.items.length > 0) {
        console.log('First item title:', firstResults.items[0].title);
      }
      
      return {
        success: true,
        executionTime,
        items: firstResults.items
      };
    } catch (error) {
      console.error('ytsr test failed:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }
  
  // 4. Implementasi caching untuk menghindari pencarian berulang
  const cache = new Map();
  
  async function cachedSearch(query, options = { limit: 5 }) {
    const cacheKey = `${query}_${JSON.stringify(options)}`;
    
    if (cache.has(cacheKey)) {
      console.log('Using cached result');
      return cache.get(cacheKey);
    }
    
    const result = await testYtsr(query, options);
    cache.set(cacheKey, result);
    return result;
  }
  
  // Benchmark function
  async function runBenchmark() {
    console.log("Running first search (no cache):");
    await cachedSearch('programming tutorial');
    
    console.log("\nRunning second search (should use cache):");
    await cachedSearch('programming tutorial');
    
    console.log("\nRunning different search:");
    await cachedSearch('music');
  }
  
  runBenchmark()
    .then(() => {
      console.log('Benchmark completed');
      process.exit(0);
    })
    .catch(error => {
      console.error('Benchmark failed:', error);
      process.exit(1);
    });