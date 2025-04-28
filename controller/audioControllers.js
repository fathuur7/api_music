import ytdl from 'ytdl-core';
import path from 'path';
import Audio from '../models/audio.js';
import os from 'os';
import fs from 'fs';
import { v2 as cloudinary } from 'cloudinary';
import dotenv from 'dotenv';
import axios from 'axios';
import { promisify } from 'util';

dotenv.config();

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

// Get video metadata using YouTube oEmbed API - more reliable in serverless
const getVideoInfo = async (videoUrl) => {
  try {
    const videoId = extractVideoId(videoUrl);
    
    if (!videoId) throw new Error('URL YouTube tidak valid');
    
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
        message: 'Audio sudah tersedia',
        audio: existingAudio
      });
    }

    // Extract video ID from URL
    const videoId = extractVideoId(videoData.url) || Date.now().toString();
    
    // Get video info - optimized for serverless
    console.log("Getting video info for:", videoData.url);
    const videoInfo = await getVideoInfo(videoData.url);
    console.log("Video info obtained:", videoInfo.title);
    
    // Create a DB entry to track processing status
    const processingAudio = new Audio({
      title: videoInfo.title || `Audio-${videoId}`,
      originalUrl: videoData.url,
      status: 'processing',
      thumbnail: videoInfo.thumbnail || '',
      duration: videoInfo.duration || '',
      durationInSeconds: videoInfo.durationInSeconds || 0,
      artist: videoInfo.author || 'Unknown',
      // Add default values for required fields
      publicId: 'pending_upload',
      audioUrl: 'pending_upload'
    });
    
    await processingAudio.save();ss
    
    await processingAudio.save();
    
    // For serverless environment, return early with processing status
    // This prevents timeout errors on Vercel
    res.json({
      success: true,
      message: 'Konversi video dimulai',
      status: 'processing',
      processingId: processingAudio._id,
      estimatedTime: '30-60 detik'
    });
    
    // Continue processing asynchronously (won't block response)
    try {
      // Path for temporary storage in OS temp directory
      const outputPath = getTempFilePath(`${videoId}.mp3`);
      
      console.log("Starting download process...");
      // Try all download methods
      await downloadAudio(videoData.url, videoInfo, outputPath);
      
      // Check if file exists and has content
      if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size === 0) {
        throw new Error('Gagal menghasilkan file audio');
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

// Endpoint to check conversion status
export const checkConversionStatus = async (req, res) => {
  try {
    const { id } = req.params;
    
    const audio = await Audio.findById(id);
    if (!audio) {
      return res.status(404).json({ success: false, message: 'Audio tidak ditemukan' });
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
      message: 'Gagal memeriksa status konversi',
      error: error.message
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
    
    // For Cloudinary, we can simply redirect to the audio URL
    // Add ?fl_attachment parameter to force download
    const downloadUrl = audio.audioUrl + "?fl_attachment=true";
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
    
    // For now, just use the existing audio from Cloudinary
    // In a future version, you could implement format and quality conversions
    let downloadUrl = audio.audioUrl;
    
    // Add format transformation parameters for Cloudinary if needed
    if (format === 'mp3' || format === 'wav' || format === 'ogg') {
      // Add format parameter to URL
      downloadUrl = downloadUrl.replace(/\.[^/.]+$/, `.${format}`);
    }
    
    // Add quality parameters if Cloudinary supports it
    if (quality === 'high') {
      downloadUrl += "?quality=80";
    } else if (quality === 'medium') {
      downloadUrl += "?quality=60";
    } else if (quality === 'low') {
      downloadUrl += "?quality=40";
    }
    
    // Add force download parameter
    downloadUrl += downloadUrl.includes('?') ? "&fl_attachment=true" : "?fl_attachment=true";
    
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
    
    // Implement SSE (Server-Sent Events) for streaming progress
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    
    // Initial status
    res.write(`data: ${JSON.stringify({ 
      id: audio._id, 
      progress: 0, 
      status: 'processing'
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
          // Simulate progress based on time (in real implementation, this would be based on actual progress)
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