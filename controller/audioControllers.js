import { video_info, stream, YouTubeVideo } from 'play-dl';
import ffmpeg from 'fluent-ffmpeg';
import path from 'path';
import Audio from '../models/audio.js';
import os from 'os';
import fs from 'fs';
import { v2 as cloudinary } from 'cloudinary';
import dotenv from 'dotenv';
import axios from 'axios';

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

// Helper function to get video info (with multiple fallbacks)
const getVideoInfo = async (videoUrl) => {
  try {
    // Extract video ID
    const videoId = videoUrl.split('v=')[1]?.split('&')[0] || 
                    videoUrl.split('youtu.be/')[1]?.split('?')[0];
    
    if (!videoId) throw new Error('Invalid YouTube URL');
    
    // Method 1: Try play-dl
    try {
      const info = await video_info(videoUrl);
      
      return {
        title: info.video_details.title,
        thumbnail: info.video_details.thumbnails.pop().url,
        duration: info.video_details.durationInSec.toString(),
        durationInSeconds: info.video_details.durationInSec,
        author: info.video_details.channel?.name || 'Unknown',
        videoDetails: info.video_details
      };
    } catch (playDlError) {
      console.log("play-dl failed to get info, using alternative method:", playDlError.message);
      
      // Method 2: Use YouTube's oEmbed API
      try {
        const response = await axios.get(`https://www.youtube.com/oembed?url=${videoUrl}&format=json`);
        
        return {
          title: response.data.title,
          thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
          author: response.data.author_name,
          duration: "Unknown", 
          durationInSeconds: 0,
          videoId: videoId
        };
      } catch (oembedError) {
        console.log("YouTube oEmbed API failed:", oembedError.message);
        
        // Method 3: Use basic metadata from URL
        return {
          title: `YouTube Audio - ${videoId}`,
          thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
          author: 'Unknown',
          duration: "Unknown",
          durationInSeconds: 0,
          videoId: videoId
        };
      }
    }
  } catch (error) {
    console.error("Error getting video info:", error);
    throw error;
  }
};

// Download video using play-dl
const downloadAudio = async (videoUrl, outputPath) => {
  try {
    // Get audio stream
    const audioStream = await stream(videoUrl, { quality: 140 }); // 140 is audio/mp4 format
    
    return new Promise((resolve, reject) => {
      // Convert to MP3 with ffmpeg
      ffmpeg(audioStream.stream)
        .audioBitrate(128)
        .format('mp3')
        .on('error', (err) => {
          console.error('FFmpeg error:', err);
          reject(err);
        })
        .on('end', resolve)
        .save(outputPath);
    });
  } catch (error) {
    console.error("Error in downloadAudio:", error);
    throw error;
  }
};

// Endpoint to convert YouTube video to audio
export const convertVideoToAudio = async (req, res) => {
  const { videoData } = req.body;
  
  if (!videoData || !videoData.url) {
    return res.status(400).json({ success: false, message: 'URL video tidak ditemukan' });
  }
  
  try {
    // Check if audio already exists in database
    const existingAudio = await Audio.findOne({ originalUrl: videoData.url });
    if (existingAudio) {
      return res.json({
        success: true,
        message: 'Audio sudah tersedia',
        audio: existingAudio
      });
    }

    // Extract video ID from URL
    const videoId = videoData.url.split('v=')[1]?.split('&')[0] || 
                    videoData.url.split('youtu.be/')[1]?.split('?')[0] || 
                    Date.now().toString();
    
    // Path for temporary storage in OS temp directory (which is writable)
    const outputPath = getTempFilePath(`${videoId}.mp3`);
    
    console.log("Getting video info for:", videoData.url);
    // Get video info
    const videoInfo = await getVideoInfo(videoData.url);
    console.log("Video info retrieved:", videoInfo.title);
    
    // Extract metadata
    const videoTitle = videoInfo.title || videoData.title || `Audio-${videoId}`;
    const thumbnailUrl = videoInfo.thumbnail || videoData.thumbnail || '';
    const duration = videoInfo.duration || videoData.duration || '';
    const durationInSeconds = videoInfo.durationInSeconds || videoData.durationInSeconds || 0;
    const artist = videoInfo.author || videoData.author || 'Unknown';
    
    console.log("Downloading audio...");
    // Download audio using play-dl
    await downloadAudio(videoData.url, outputPath);
    console.log("Audio downloaded to:", outputPath);
    
    // Check if file exists and has content
    if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size === 0) {
      throw new Error('Failed to generate audio file');
    }
    
    console.log("Uploading to Cloudinary...");
    // Upload the audio file to Cloudinary
    const cloudinaryResult = await uploadToCloudinary(outputPath);
    console.log("Uploaded to Cloudinary:", cloudinaryResult.secure_url);
    
    // Delete the temporary file
    try {
      fs.unlinkSync(outputPath);
    } catch (deleteError) {
      console.warn("Couldn't delete temp file:", deleteError.message);
    }
    
    console.log("Saving to database...");
    // Save audio data to database
    const newAudio = new Audio({
      title: videoTitle,
      originalUrl: videoData.url,
      audioUrl: cloudinaryResult.secure_url,
      publicId: cloudinaryResult.public_id,
      thumbnail: thumbnailUrl,
      duration: duration,
      durationInSeconds: durationInSeconds,
      artist: artist
    });
    
    await newAudio.save();
    console.log("Audio saved to database!");
    
    res.json({
      success: true,
      message: 'Video berhasil dikonversi ke audio',
      audio: newAudio
    });
      
  } catch (error) {
    console.error('Error converting video to audio:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Gagal memproses video', 
      error: error.message,
      detail: 'Kesalahan saat mengunduh atau memproses audio'
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
    const downloadUrl = audio.audioUrl + "?fl_attachment=true";
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
    
    // Implement SSE (Server-Sent Events) for streaming progress
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    
    const downloadId = Date.now().toString();
    let progress = 0;
    
    // Save reference to interval
    const progressInterval = setInterval(() => {
      // Simulate progress (in real implementation, this would get actual download status)
      progress += 5;
      
      if (progress <= 100) {
        res.write(`data: ${JSON.stringify({ id: downloadId, progress, status: progress < 100 ? 'downloading' : 'completed' })}\n\n`);
      } else {
        clearInterval(progressInterval);
        res.write(`data: ${JSON.stringify({ id: downloadId, progress: 100, status: 'completed' })}\n\n`);
        res.end();
      }
    }, 500);
    
    // Handle client disconnect
    res.on('close', () => {
      clearInterval(progressInterval);
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