// controller/audioControllers.js
import { video_info, stream } from 'play-dl';
import { v2 as cloudinary } from 'cloudinary';
import axios from 'axios';
import ytdl from 'ytdl-core';
import ytdlDistube from '@distube/ytdl-core'; // More resilient ytdl version
import { createWriteStream, unlink, mkdirSync, existsSync } from 'fs';
import { promisify } from 'util';
import { pipeline } from 'stream';
import path from 'path';
import os from 'os';

// Promisify utilities
const unlinkAsync = promisify(unlink);
const pipelineAsync = promisify(pipeline);

// Cloudinary configuration
cloudinary.config({
  cloud_name: process.env.CLOUD_NAME,
  api_key: process.env.API_KEY,
  api_secret: process.env.API_SECRET
});

// Creates download directory if it doesn't exist
const ensureDownloadDir = (dirPath) => {
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true });
  }
  return dirPath;
};

// Clean filename for safe storage
const sanitizeFileName = (title) => {
  return title
    .replace(/[<>:"/\\|?*]+/g, '')
    .replace(/[^a-zA-Z0-9]/g, '_')
    .substring(0, 30);
};

// Upload file to Cloudinary
const uploadToCloudinary = async (filePath, title) => {
  return new Promise((resolve, reject) => {
    cloudinary.uploader.upload(
      filePath,
      {
        resource_type: 'video',
        public_id: `audio_${Date.now()}_${sanitizeFileName(title)}`
      },
      (error, result) => {
        if (error) {
          return reject(error);
        }
        resolve(result);
      }
    );
  });
};

// Get video info using YouTube API
const getVideoInfoFromAPI = async (videoId) => {
  try {
    const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;
    if (!YOUTUBE_API_KEY) {
      throw new Error('YouTube API key is not configured');
    }
    
    const response = await axios.get(`https://www.googleapis.com/youtube/v3/videos`, {
      params: {
        part: 'snippet,contentDetails',
        id: videoId,
        key: YOUTUBE_API_KEY
      }
    });
    
    if (response.data.items && response.data.items.length > 0) {
      const video = response.data.items[0];
      return {
        title: video.snippet.title,
        duration: video.contentDetails.duration, // ISO 8601 duration format
        thumbnailUrl: video.snippet.thumbnails.high?.url || video.snippet.thumbnails.medium?.url || video.snippet.thumbnails.default?.url
      };
    }
    return null;
  } catch (error) {
    console.error('Error fetching video info from API:', error);
    throw error;
  }
};

// Extract video ID from YouTube URL
const extractVideoId = (url) => {
  const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
  const match = url.match(regExp);
  return match && match[2].length === 11 ? match[2] : null;
};

// Main controller function for YouTube to Cloudinary conversion
export const convertVideoToAudio = async (req, res) => {
  const { url } = req.body;
  
  if (!url) {
    return res.status(400).json({ error: 'URL tidak valid' });
  }

  let tempFilePath = null;
  
  try {
    // Validate the URL (using both libraries for maximum compatibility)
    if (!ytdl.validateURL(url) && !ytdlDistube.validateURL(url)) {
      return res.status(400).json({ error: 'URL YouTube tidak valid' });
    }

    // Try each method in sequence until one works
    const methods = [
      tryGetInfoWithYtdlCore,
      tryGetInfoWithDistubeYtdl,
      tryGetInfoWithPlayDl,
      tryGetInfoWithYoutubeAPI
    ];
    
    let videoInfo = null;
    
    // Try to get video info with each method
    for (const method of methods) {
      try {
        console.log(`Attempting to get video info with ${method.name}...`);
        videoInfo = await method(url);
        if (videoInfo) {
          console.log(`Successfully retrieved video info with ${method.name}`);
          break;
        }
      } catch (error) {
        console.error(`${method.name} failed:`, error.message);
      }
    }
    
    if (!videoInfo) {
      return res.status(500).json({ error: 'Tidak dapat mengambil informasi video' });
    }
    
    // Download methods to try in sequence
    const downloadMethods = [
      tryDownloadWithPlayDl,
      tryDownloadWithYtdlCore,
      tryDownloadWithDistubeYtdl,
      tryDownloadWithYtdlCoreAndCookies,
      tryDownloadWithDistubeAndCookies
    ];
    
    let uploadResult = null;
    let lastError = null;
    
    // Try each download method until one works
    for (const method of downloadMethods) {
      try {
        console.log(`Attempting download with ${method.name}...`);
        const result = await method(url, videoInfo);
        if (result.filePath) {
          tempFilePath = result.filePath;
          
          // Upload to Cloudinary
          uploadResult = await uploadToCloudinary(tempFilePath, videoInfo.title);
          
          console.log(`Successfully uploaded to Cloudinary with ${method.name}`);
          break;
        }
      } catch (error) {
        console.error(`${method.name} failed:`, error.message);
        lastError = error;
        
        // Clean up temp file if it exists before trying next method
        if (tempFilePath) {
          try {
            await unlinkAsync(tempFilePath);
            tempFilePath = null;
          } catch (unlinkError) {
            console.error('Failed to delete temp file:', unlinkError);
          }
        }
      }
    }
    
    if (!uploadResult) {
      return res.status(500).json({
        error: 'Semua metode unduhan gagal',
        message: lastError?.message || 'Unknown error'
      });
    }
    
    // Clean up the temporary file
    if (tempFilePath) {
      try {
        await unlinkAsync(tempFilePath);
      } catch (unlinkError) {
        console.error('Failed to delete temp file:', unlinkError);
      }
    }
    
    // Return success response
    return res.status(200).json({
      success: true,
      title: videoInfo.title,
      url: uploadResult.secure_url,
      filename: uploadResult.public_id,
      duration: videoInfo.duration || videoInfo.lengthSeconds,
      thumbnail: videoInfo.thumbnailUrl || videoInfo.thumbnail,
    });
    
  } catch (error) {
    console.error('General error:', error);
    
    // Clean up temp file if it exists
    if (tempFilePath) {
      try {
        await unlinkAsync(tempFilePath);
      } catch (unlinkError) {
        console.error('Failed to delete temp file:', unlinkError);
      }
    }
    
    return res.status(500).json({
      error: 'Terjadi kesalahan saat memproses video',
      message: error.message
    });
  }
};

// ===== VIDEO INFO RETRIEVAL METHODS =====

// Method 1: Get info with ytdl-core
async function tryGetInfoWithYtdlCore(url) {
  const info = await ytdl.getInfo(url);
  return {
    title: info.videoDetails.title,
    duration: info.videoDetails.lengthSeconds,
    thumbnailUrl: info.videoDetails.thumbnails.at(-1)?.url,
  };
}

// Method 2: Get info with @distube/ytdl-core
async function tryGetInfoWithDistubeYtdl(url) {
  const info = await ytdlDistube.getInfo(url);
  return {
    title: info.videoDetails.title,
    duration: info.videoDetails.lengthSeconds,
    thumbnailUrl: info.videoDetails.thumbnails.at(-1)?.url,
  };
}

// Method 3: Get info with play-dl
async function tryGetInfoWithPlayDl(url) {
  const info = await video_info(url);
  return {
    title: info.video_details.title,
    duration: info.video_details.durationInSec,
    thumbnailUrl: info.video_details.thumbnails.at(-1)?.url,
  };
}

// Method 4: Get info with YouTube API
async function tryGetInfoWithYoutubeAPI(url) {
  const videoId = extractVideoId(url);
  if (!videoId) {
    throw new Error('Could not extract video ID');
  }
  return await getVideoInfoFromAPI(videoId);
}

// ===== DOWNLOAD METHODS =====

// Method 1: Download with play-dl
async function tryDownloadWithPlayDl(url, videoInfo) {
  const tempDir = os.tmpdir();
  const filename = `${Date.now()}_${sanitizeFileName(videoInfo.title)}.mp3`;
  const filePath = path.join(tempDir, filename);
  
  const audioStream = await stream(url, { 
    quality: 140, // m4a 128 kbps audio format
    discordPlayerCompatibility: false
  });
  
  if (!audioStream) {
    throw new Error('Could not create audio stream with play-dl');
  }
  
  const fileWriter = createWriteStream(filePath);
  await pipelineAsync(audioStream.stream, fileWriter);
  
  return { filePath };
}

// Method 2: Download with ytdl-core
async function tryDownloadWithYtdlCore(url, videoInfo) {
  const tempDir = os.tmpdir();
  const filename = `${Date.now()}_${sanitizeFileName(videoInfo.title)}.mp3`;
  const filePath = path.join(tempDir, filename);
  
  const audioStream = ytdl(url, { 
    quality: 'highestaudio',
    filter: 'audioonly',
    highWaterMark: 1 << 25 // 32MB buffer for faster streaming
  });
  
  const fileWriter = createWriteStream(filePath);
  await pipelineAsync(audioStream, fileWriter);
  
  return { filePath };
}

// Method 3: Download with @distube/ytdl-core
async function tryDownloadWithDistubeYtdl(url, videoInfo) {
  const tempDir = os.tmpdir();
  const filename = `${Date.now()}_${sanitizeFileName(videoInfo.title)}.mp3`;
  const filePath = path.join(tempDir, filename);
  
  const audioStream = ytdlDistube(url, { 
    quality: 'highestaudio',
    filter: 'audioonly',
    highWaterMark: 1 << 25 // 32MB buffer for faster streaming
  });
  
  const fileWriter = createWriteStream(filePath);
  await pipelineAsync(audioStream, fileWriter);
  
  return { filePath };
}

// Method 4: Download with ytdl-core + cookies
async function tryDownloadWithYtdlCoreAndCookies(url, videoInfo) {
  const cookieString = process.env.YOUTUBE_COOKIES || '';
  
  if (!cookieString) {
    throw new Error('No YouTube cookies available for authentication');
  }
  
  const tempDir = os.tmpdir();
  const filename = `${Date.now()}_${sanitizeFileName(videoInfo.title)}.mp3`;
  const filePath = path.join(tempDir, filename);
  
  const audioStream = ytdl(url, { 
    quality: 'highestaudio',
    filter: 'audioonly',
    highWaterMark: 1 << 25,
    requestOptions: {
      headers: {
        cookie: cookieString
      }
    }
  });
  
  const fileWriter = createWriteStream(filePath);
  await pipelineAsync(audioStream, fileWriter);
  
  return { filePath };
}

// Method 5: Download with @distube/ytdl-core + cookies
async function tryDownloadWithDistubeAndCookies(url, videoInfo) {
  const cookieString = process.env.YOUTUBE_COOKIES || '';
  
  if (!cookieString) {
    throw new Error('No YouTube cookies available for authentication');
  }
  
  const tempDir = os.tmpdir();
  const filename = `${Date.now()}_${sanitizeFileName(videoInfo.title)}.mp3`;
  const filePath = path.join(tempDir, filename);
  
  const audioStream = ytdlDistube(url, { 
    quality: 'highestaudio',
    filter: 'audioonly',
    highWaterMark: 1 << 25,
    requestOptions: {
      headers: {
        cookie: cookieString
      }
    }
  });
  
  const fileWriter = createWriteStream(filePath);
  await pipelineAsync(audioStream, fileWriter);
  
  return { filePath };
}

// Health check route for YouTube API
export const youtubeApiHealthCheck = async (req, res) => {
  try {
    const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;
    if (!YOUTUBE_API_KEY) {
      return res.status(500).json({
        status: 'error',
        message: 'YouTube API key is not configured'
      });
    }
    
    const response = await axios.get('https://www.googleapis.com/youtube/v3/videos', {
      params: {
        part: 'snippet',
        chart: 'mostPopular',
        maxResults: 1,
        key: YOUTUBE_API_KEY
      }
    });
    
    return res.json({
      status: 'success',
      message: 'YouTube API connection successful',
      data: {
        apiKeyWorking: true,
        videoCount: response.data.items.length
      }
    });
  } catch (error) {
    return res.status(500).json({
      status: 'error',
      message: 'YouTube API connection failed',
      error: error.response?.data || error.message
    });
  }
};

// Function to download audio file with progress tracking
export const downloadWithProgress = async (req, res) => {
  const { url } = req.body;
  const format = req.body.format || 'mp3';
  
  if (!url || (!ytdl.validateURL(url) && !ytdlDistube.validateURL(url))) {
    return res.status(400).json({ error: 'URL YouTube tidak valid.' });
  }
  
  try {
    const downloadPath = ensureDownloadDir(path.join(os.tmpdir(), 'yt-downloads'));
    
    // Try getting info with different methods
    let info;
    try {
      info = await ytdlDistube.getInfo(url);
    } catch (error) {
      try {
        info = await ytdl.getInfo(url);
      } catch (error2) {
        return res.status(500).json({ error: 'Gagal mendapatkan informasi video', message: error2.message });
      }
    }
    
    const title = info.videoDetails.title.replace(/[<>:"/\\|?*]+/g, '');
    const fileExtension = format === 'mp3' ? 'mp3' : 'mp4';
    const filePath = path.join(downloadPath, `${title}.${fileExtension}`);
    
    const options = {
      filter: format === 'mp3' ? 'audioonly' : 'videoandaudio',
      quality: format === 'mp3' ? 'highestaudio' : 'highestvideo',
      highWaterMark: 1 << 25 // 32MB buffer
    };
    
    // Try with distube first, then fall back to standard ytdl
    let stream;
    try {
      stream = ytdlDistube(url, options);
    } catch (error) {
      stream = ytdl(url, options);
    }
    
    const fileStream = createWriteStream(filePath);
    
    // SSE setup for progress updates
    if (req.headers.accept && req.headers.accept.includes('text/event-stream')) {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
      });
      
      let downloaded = 0;
      const totalSize = parseInt(info.videoDetails.lengthSeconds) * 128 * 1024; // Estimate 128kbps
      
      stream.on('data', (chunk) => {
        downloaded += chunk.length;
        const progress = Math.min(100, Math.floor((downloaded / totalSize) * 100));
        if (progress % 5 === 0) { // Update every 5%
          res.write(`data: ${JSON.stringify({ progress })}\n\n`);
        }
      });
      
      stream.on('end', () => {
        res.write(`data: ${JSON.stringify({ 
          progress: 100, 
          complete: true, 
          filePath,
          title: info.videoDetails.title,
          duration: info.videoDetails.lengthSeconds,
          thumbnail: info.videoDetails.thumbnails.at(-1)?.url
        })}\n\n`);
        res.end();
      });
      
      stream.on('error', (err) => {
        res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
        res.end();
      });
      
      req.on('close', () => {
        // Handle client disconnect
        stream.destroy();
        res.end();
      });
    } else {
      // Regular response without SSE
      try {
        await pipelineAsync(stream, fileStream);
        
        res.status(200).json({
          success: true,
          filePath,
          title: info.videoDetails.title,
          duration: info.videoDetails.lengthSeconds,
          thumbnail: info.videoDetails.thumbnails.at(-1)?.url
        });
      } catch (error) {
        res.status(500).json({ error: 'Download gagal', message: error.message });
      }
    }
  } catch (error) {
    console.error('General error:', error);
    res.status(500).json({ error: 'Terjadi kesalahan', message: error.message });
  }
};