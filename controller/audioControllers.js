import ytdl from '@distube/ytdl-core';
import fs from 'fs';
import path from 'path';
import { pipeline } from 'stream';
import { promisify } from 'util';
import { v2 as cloudinary } from 'cloudinary';
import { Readable } from 'stream';
import os from 'os';

// Promisify pipeline for async/await
const pipe = promisify(pipeline);

// Cloudinary configuration
// You should set these in your environment variables
cloudinary.config({
  cloud_name: process.env.CLOUD_NAME,
  api_key: process.env.API_KEY,
  api_secret: process.env.API_SECRET
});

/**
 * Convert YouTube video to audio and upload to Cloudinary
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
export const convertVideoToAudio = async (req, res) => {
  try {
    const { videoUrl, format = 'mp3' } = req.body;
    
    if (!videoUrl) {
      return res.status(400).json({ 
        success: false, 
        message: 'Video URL is required' 
      });
    }

    // Extract YouTube video ID
    const videoId = extractYoutubeId(videoUrl);
    if (!videoId) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid YouTube URL' 
      });
    }

    // Get video info
    const info = await ytdl.getInfo(videoUrl);
    const videoTitle = info.videoDetails.title.replace(/[<>:"/\\|?*]+/g, '');
    
    // Create temp file path
    const tempDir = os.tmpdir();
    const fileExtension = format === 'mp3' ? 'mp3' : 'mp4';
    const tempFilePath = path.join(tempDir, `${videoId}.${fileExtension}`);

    // Download options
    const options = {
      filter: format === 'mp3' ? 'audioonly' : 'videoandaudio',
      quality: format === 'mp3' ? 'highestaudio' : 'highestvideo',
      highWaterMark: 1 << 25 // 32MB buffer for faster streaming
    };

    // Create write stream
    const writeStream = fs.createWriteStream(tempFilePath);
    
    // Download from YouTube
    const stream = ytdl(videoUrl, options);
    
    // Track download progress
    let downloaded = 0;
    const totalSize = parseInt(info.videoDetails.lengthSeconds) * 128 * 1024; // Estimate size for 128kbps audio
    
    stream.on('data', (chunk) => {
      downloaded += chunk.length;
      const progress = Math.min(100, Math.floor((downloaded / totalSize) * 100));
      // You could emit progress via websocket here if needed
    });

    // Wait for download to complete
    await pipe(stream, writeStream);
    
    // Upload to Cloudinary
    const cloudinaryResult = await uploadToCloudinary(tempFilePath, videoTitle, format);
    
    // Clean up temp file
    fs.unlinkSync(tempFilePath);

    // Return success response
    return res.status(200).json({
      success: true,
      message: 'Video successfully converted and uploaded',
      data: {
        title: videoTitle,
        format: format,
        url: cloudinaryResult.secure_url,
        public_id: cloudinaryResult.public_id,
        duration: cloudinaryResult.duration
      }
    });
    
  } catch (error) {
    console.error('Error in convertVideoToAudio:', error);
    return res.status(500).json({
      success: false,
      message: `Failed to process video: ${error.message}`
    });
  }
};

/**
 * Extract YouTube video ID from URL
 * @param {string} url - YouTube URL
 * @returns {string|null} - YouTube video ID or null if invalid
 */
export function extractYoutubeId(url) {
  if (!url) return null;
  
  // Handle various YouTube URL formats
  const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
  const match = url.match(regExp);
  
  return (match && match[2].length === 11) ? match[2] : null;
}

/**
 * Upload file to Cloudinary
 * @param {string} filePath - Path to the local file
 * @param {string} title - Title for the uploaded file
 * @param {string} format - File format ('mp3' or 'mp4')
 * @returns {Promise<Object>} - Cloudinary upload result
 */
export async function uploadToCloudinary(filePath, title, format) {
  const folder = 'youtube-downloads';
  
  return new Promise((resolve, reject) => {
    cloudinary.uploader.upload(
      filePath,
      {
        resource_type: format === 'mp3' ? 'audio' : 'video',
        public_id: `${folder}/${title}`,
        overwrite: true,
        format: format
      },
      (error, result) => {
        if (error) {
          reject(error);
        } else {
          resolve(result);
        }
      }
    );
  });
}

export default { convertVideoToAudio, extractYoutubeId, uploadToCloudinary };