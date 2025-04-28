import ytdl from 'ytdl-core';
import path from 'path';
import Audio from '../models/audio.js';
import os from 'os';
import fs from 'fs';
import { v2 as cloudinary } from 'cloudinary';
import axios from 'axios';
import { promisify } from 'util';

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
const uploadToCloudinary = (filePath, folder = 'youtube-audios') => {
  return new Promise((resolve, reject) => {
    cloudinary.uploader.upload(
      filePath, 
      { 
        resource_type: 'auto',
        folder: folder,
        use_filename: true
      }, 
      (error, result) => {
        if (error) reject(error);
        else resolve(result);
      }
    );
  });
};

// Extract video ID from YouTube URL
const extractVideoId = (url) => {
  // Pola untuk mengekstrak ID video YouTube dari berbagai format URL
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
  
  // Coba ekstrak ID dengan memecah URL
  if (url.includes('v=')) {
    return url.split('v=')[1]?.split('&')[0];
  } else if (url.includes('youtu.be/')) {
    return url.split('youtu.be/')[1]?.split('?')[0];
  }
  
  return null;
};

// Get video metadata using YouTube oEmbed API - more reliable in serverless
const getVideoInfo = async (videoUrl) => {
  try {
    const videoId = extractVideoId(videoUrl);
    
    if (!videoId) throw new Error('Invalid YouTube URL');
    
    // First try with oEmbed API - very reliable and lightweight
    try {
      const response = await axios.get(`https://www.youtube.com/oembed?url=${videoUrl}&format=json`, {
        timeout: 5000
      });
      
      return {
        title: response.data.title,
        thumbnail: `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`,
        author: response.data.author_name,
        videoId
      };
    } catch (oembedError) {
      console.log("YouTube oEmbed API failed:", oembedError.message);
      
      // Fall back to ytdl-core but with timeout
      try {
        const info = await Promise.race([
          ytdl.getInfo(videoId),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('ytdl-core timeout')), 10000)
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
      } catch (ytdlError) {
        console.log("ytdl-core failed:", ytdlError.message);
        
        // Most basic fallback
        return {
          title: `YouTube Audio - ${videoId}`,
          thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
          author: 'Unknown',
          videoId
        };
      }
    }
  } catch (error) {
    console.error("Error getting video info:", error.message);
    throw error;
  }
};

// Direct download without ytdl-core (for reliability)
const directAudioDownload = async (url, outputPath) => {
  console.log("Attempting direct audio download...");
  
  const response = await axios({
    method: 'GET',
    url,
    responseType: 'stream',
    timeout: 30000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    }
  });
  
  return new Promise((resolve, reject) => {
    const writer = fs.createWriteStream(outputPath);
    
    response.data.pipe(writer);
    
    writer.on('finish', () => {
      console.log("Direct download successful!");
      resolve(true);
    });
    
    writer.on('error', (err) => {
      console.error("Error writing file:", err.message);
      reject(err);
    });
  });
};

// Download audio using ytdl-core but optimized for serverless
const downloadAudio = async (videoUrl, videoInfo, outputPath) => {
  console.log("Starting audio download process...");
  
  // If we have formats from the video info, try to find a direct audio URL
  if (videoInfo.formats && videoInfo.formats.length > 0) {
    // Find audio formats and sort by quality
    const audioFormats = videoInfo.formats
      .filter(f => f.mimeType && f.mimeType.includes('audio/'))
      .sort((a, b) => (b.audioBitrate || 0) - (a.audioBitrate || 0));
    
    // If we have audio formats, use the best one
    if (audioFormats.length > 0 && audioFormats[0].url) {
      try {
        console.log("Direct audio URL found, attempting direct download...");
        await directAudioDownload(audioFormats[0].url, outputPath);
        
        // Verify the file exists and has content
        if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) {
          return true;
        }
      } catch (directError) {
        console.error("Direct download failed:", directError.message);
        // Continue to next method
      }
    }
  }
  
  // Try with ytdl-core direct pipe (no ffmpeg)
  try {
    console.log("Trying ytdl-core direct download...");
    
    // Use a robust configuration for ytdl-core
    const options = {
      quality: 'highestaudio',
      filter: 'audioonly',
      highWaterMark: 1 << 25, // 32MB buffer
      requestOptions: {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      }
    };
    
    return new Promise((resolve, reject) => {
      // Set a timeout for the entire operation
      const downloadTimeout = setTimeout(() => {
        reject(new Error('Download timeout after 45 seconds'));
      }, 45000);
      
      const stream = ytdl(videoUrl, options);
      const writer = fs.createWriteStream(outputPath);
      
      stream.on('error', (err) => {
        clearTimeout(downloadTimeout);
        console.error("Error on ytdl stream:", err.message);
        reject(err);
      });
      
      writer.on('error', (err) => {
        clearTimeout(downloadTimeout);
        console.error("Error writing file:", err.message);
        reject(err);
      });
      
      writer.on('finish', () => {
        clearTimeout(downloadTimeout);
        // Check if file has content
        const stats = fs.statSync(outputPath);
        if (stats.size > 0) {
          console.log("ytdl-core download successful!");
          resolve(true);
        } else {
          reject(new Error("Generated file is empty"));
        }
      });
      
      // Pipe the stream directly to file
      stream.pipe(writer);
    });
  } catch (ytdlError) {
    console.error("All download methods failed:", ytdlError.message);
    throw new Error("All download methods failed");
  }
};

// Main endpoint for YouTube to audio conversion
export const convertVideoToAudio = async (req, res) => {
  const { videoData } = req.body;
  
  if (!videoData || !videoData.url) {
    return res.status(400).json({ success: false, message: 'URL video tidak ditemukan' });
  }
  
  try {
    console.log("Processing request for URL:", videoData.url);
    
    // Check if audio already exists in database
    const existingAudio = await Audio.findOne({ originalUrl: videoData.url });
    if (existingAudio) {
      console.log("Audio already available in database");
      return res.json({
        success: true,
        message: 'Audio already available',
        audio: existingAudio
      });
    }

    // Extract video ID from URL
    const videoId = extractVideoId(videoData.url) || Date.now().toString();
    
    // Get video info - optimized for serverless
    console.log("Getting video info for:", videoData.url);
    const videoInfo = await getVideoInfo(videoData.url);
    console.log("Video info obtained:", videoInfo.title);
    
    // Create a DB entry to track processing status (optional)
    const processingAudio = new Audio({
      title: videoInfo.title || `Audio-${videoId}`,
      originalUrl: videoData.url,
      status: 'processing',
      thumbnail: videoInfo.thumbnail || '',
      duration: videoInfo.duration || '',
      durationInSeconds: videoInfo.durationInSeconds || 0,
      artist: videoInfo.author || 'Unknown'
    });
    
    // For serverless environment, return early with processing status
    // This prevents timeout errors on Vercel
    res.json({
      success: true,
      message: 'Video conversion started',
      status: 'processing',
      processingId: processingAudio._id,
      estimatedTime: '30-60 seconds'
    });
    
    // Continue processing asynchronously (won't block response)
    try {
      await processingAudio.save();
      
      // Path for temporary storage in OS temp directory
      const outputPath = getTempFilePath(`${videoId}.mp3`);
      
      console.log("Starting download process...");
      // Try all download methods
      await downloadAudio(videoData.url, videoInfo, outputPath);
      
      // Check if file exists and has content
      if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size === 0) {
        throw new Error('Failed to generate audio file');
      }
      
      console.log("Audio downloaded successfully, uploading to Cloudinary...");
      // Upload audio file to Cloudinary
      const cloudinaryResult = await uploadToCloudinary(outputPath);
      console.log("Uploaded to Cloudinary:", cloudinaryResult.secure_url);
      
      // Delete temporary file
      try {
        fs.unlinkSync(outputPath);
        console.log("Temporary file deleted");
      } catch (deleteError) {
        console.warn("Unable to delete temp file:", deleteError.message);
      }
      
      console.log("Saving audio data to database...");
      // Update the processing entry with completed data
      processingAudio.audioUrl = cloudinaryResult.secure_url;
      processingAudio.publicId = cloudinaryResult.public_id;
      processingAudio.status = 'completed';
      await processingAudio.save();
      
      console.log("Audio successfully saved to database");
    } catch (processingError) {
      console.error("Error in async processing:", processingError);
      // Update the record with error status
      processingAudio.status = 'failed';
      processingAudio.errorMessage = processingError.message;
      await processingAudio.save();
    }
  } catch (initialError) {
    console.error('Error converting video to audio:', initialError);
    
    // Provide more specific error message based on common problems
    let errorMessage = 'Failed to process video';
    let errorDetail = 'Error downloading or processing audio';
    let errorCode = 500;
    
    if (initialError.message.includes('410')) {
      errorMessage = 'YouTube API unavailable (Error 410)';
      errorDetail = 'YouTube has changed their API. Try again later or use a different video URL.';
    } else if (initialError.message.includes('sign in') || initialError.message.includes('login')) {
      errorMessage = 'Video requires login';
      errorDetail = 'This video requires YouTube login and cannot be downloaded.';
      errorCode = 403;
    } else if (initialError.message.includes('copyright')) {
      errorMessage = 'Copyright issue';
      errorDetail = 'This video has copyright restrictions.';
      errorCode = 403;
    } else if (initialError.message.includes('private')) {
      errorMessage = 'Video is private';
      errorDetail = 'This video is set to private by its owner and cannot be accessed.';
      errorCode = 403;
    } else if (initialError.message.includes('tidak valid') || initialError.message.includes('invalid')) {
      errorMessage = 'Invalid YouTube URL';
      errorDetail = 'Please check the URL and try again.';
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

// Endpoint to check conversion status
export const checkConversionStatus = async (req, res) => {
  try {
    const { id } = req.params;
    
    const audio = await Audio.findById(id);
    if (!audio) {
      return res.status(404).json({ success: false, message: 'Audio not found' });
    }
    
    res.json({
      success: true,
      status: audio.status,
      audio: audio.status === 'completed' ? audio : undefined,
      error: audio.errorMessage
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to check conversion status',
      error: error.message
    });
  }
};

// Rest of your code for other endpoints...