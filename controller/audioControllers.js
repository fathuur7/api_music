// controller/audioControllers.js
import { video_info, stream } from 'play-dl';
import { v2 as cloudinary } from 'cloudinary';
import axios from 'axios';
import ytdl from 'ytdl-core';
import { createWriteStream, unlink } from 'fs';
import { promisify } from 'util';
import path from 'path';
import os from 'os';

// Promisify unlink
const unlinkAsync = promisify(unlink);

// Cloudinary configuration
cloudinary.config({
  cloud_name: process.env.CLOUD_NAME,
  api_key: process.env.API_KEY,
  api_secret: process.env.API_SECRET
});

// Function to upload a local file to Cloudinary
const uploadToCloudinary = async (filePath, title) => {
  return new Promise((resolve, reject) => {
    cloudinary.uploader.upload(
      filePath,
      {
        resource_type: 'video',
        public_id: `audio_${Date.now()}_${title.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 30)}`
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

// Alternative method using YouTube Data API for getting video info
const getVideoInfoFromAPI = async (videoId) => {
  try {
    const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY || 'YOUR_API_KEY'; // Replace with your actual API key
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

// Download the file to a temporary location first
const downloadToTemp = async (stream, title) => {
  const tempDir = os.tmpdir();
  const tempFilePath = path.join(tempDir, `${Date.now()}_${title.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 30)}.mp3`);
  
  return new Promise((resolve, reject) => {
    const fileWriter = createWriteStream(tempFilePath);
    
    stream.pipe(fileWriter);
    
    fileWriter.on('finish', () => {
      resolve(tempFilePath);
    });
    
    fileWriter.on('error', (err) => {
      reject(err);
    });
    
    stream.on('error', (err) => {
      fileWriter.end();
      reject(err);
    });
  });
};

// Controller for converting YouTube video to audio
export const convertVideoToAudio = async (req, res) => {
  const { url } = req.body;
  
  if (!url) {
    return res.status(400).json({ error: 'Invalid URL' });
  }
  
  let tempFilePath = null;

  try {
    // Extract video ID
    const videoId = extractVideoId(url);
    if (!videoId) {
      return res.status(400).json({ error: 'Could not extract video ID from URL' });
    }

    // Get video info from YouTube API
    const videoInfo = await getVideoInfoFromAPI(videoId);
    if (!videoInfo) {
      return res.status(400).json({ error: 'Could not retrieve video information' });
    }
    
    // Try different methods in sequence
    const methods = [
      tryPlayDl,
      tryYtdlCore,
      tryYtdlCoreWithCookie
    ];
    
    let result = null;
    let lastError = null;
    
    for (const method of methods) {
      try {
        result = await method(url, videoInfo);
        if (result) {
          // Return success response with audio details
          return res.status(200).json({
            success: true,
            title: videoInfo.title,
            url: result.secure_url,
            filename: result.public_id,
            duration: videoInfo.duration,
            thumbnail: videoInfo.thumbnailUrl,
            method: method.name
          });
        }
      } catch (error) {
        console.error(`${method.name} failed:`, error.message);
        lastError = error;
        
        // Clean up temp file if it exists and we're moving to the next method
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
    
    // If we get here, all methods failed
    return res.status(500).json({
      error: 'All download methods failed',
      message: lastError?.message || 'Unknown error'
    });
    
  } catch (error) {
    console.error('Error:', error);
    
    // Clean up temp file if it exists
    if (tempFilePath) {
      try {
        await unlinkAsync(tempFilePath);
      } catch (unlinkError) {
        console.error('Failed to delete temp file:', unlinkError);
      }
    }
    
    return res.status(500).json({
      error: 'An error occurred while processing the video',
      message: error.message
    });
  }
};

// Method 1: Try play-dl
async function tryPlayDl(url, videoInfo) {
  console.log('Attempting download with play-dl...');
  
  // Get audio stream using play-dl
  const audioStream = await stream(url, { 
    quality: 140, // m4a 128 kbps audio format
    discordPlayerCompatibility: false
  });
  
  if (!audioStream) {
    throw new Error('Could not create audio stream with play-dl');
  }
  
  // Download to temp file
  const tempFilePath = await downloadToTemp(audioStream.stream, videoInfo.title);
  
  // Upload to Cloudinary from local file
  const result = await uploadToCloudinary(tempFilePath, videoInfo.title);
  
  // Delete temp file
  await unlinkAsync(tempFilePath);
  
  return result;
}

// Method 2: Try ytdl-core
async function tryYtdlCore(url, videoInfo) {
  console.log('Attempting download with ytdl-core...');
  
  // Get audio stream using ytdl-core
  const ytdlStream = ytdl(url, { 
    quality: 'highestaudio',
    filter: 'audioonly'
  });
  
  // Download to temp file
  const tempFilePath = await downloadToTemp(ytdlStream, videoInfo.title);
  
  // Upload to Cloudinary from local file
  const result = await uploadToCloudinary(tempFilePath, videoInfo.title);
  
  // Delete temp file
  await unlinkAsync(tempFilePath);
  
  return result;
}

// Method 3: Try ytdl-core with cookie
async function tryYtdlCoreWithCookie(url, videoInfo) {
  console.log('Attempting download with ytdl-core + cookies...');
  
  // These are example cookies - you should implement a proper cookie retrieval method
  // These could be stored in environment variables or a database
  const cookieString = process.env.YOUTUBE_COOKIES || '';
  
  if (!cookieString) {
    throw new Error('No YouTube cookies available for authentication');
  }
  
  // Get audio stream using ytdl-core with cookies
  const ytdlStream = ytdl(url, { 
    quality: 'highestaudio',
    filter: 'audioonly',
    requestOptions: {
      headers: {
        cookie: cookieString
      }
    }
  });
  
  // Download to temp file
  const tempFilePath = await downloadToTemp(ytdlStream, videoInfo.title);
  
  // Upload to Cloudinary from local file
  const result = await uploadToCloudinary(tempFilePath, videoInfo.title);
  
  // Delete temp file
  await unlinkAsync(tempFilePath);
  
  return result;
}

// Add a healthcheck route to verify API key
export const youtubeApiHealthCheck = async (req, res) => {
  try {
    const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY || 'YOUR_API_KEY'; // Replace with your actual API key
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