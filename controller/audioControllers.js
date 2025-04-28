import ytdl from 'ytdl-core';
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

// Helper function to get video info using unofficial API
const getVideoInfo = async (videoUrl) => {
  try {
    // Extract video ID
    const videoId = videoUrl.split('v=')[1]?.split('&')[0] || 
                    videoUrl.split('youtu.be/')[1]?.split('?')[0];
    
    if (!videoId) throw new Error('Invalid YouTube URL');
    
    // First try ytdl-core
    try {
      const info = await ytdl.getInfo(videoId);
      return {
        title: info.videoDetails.title,
        thumbnail: info.videoDetails.thumbnails[0].url,
        duration: info.videoDetails.lengthSeconds,
        durationInSeconds: parseInt(info.videoDetails.lengthSeconds),
        author: info.videoDetails.author.name,
        formats: info.formats
      };
    } catch (ytdlError) {
      console.log("ytdl-core failed to get info, using alternative method:", ytdlError.message);
      
      // Alternative method using YouTube's Iframe API data
      const response = await axios.get(`https://www.youtube.com/oembed?url=${videoUrl}&format=json`);
      
      return {
        title: response.data.title,
        thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
        author: response.data.author_name,
        duration: "Unknown", // Unfortunately this API doesn't provide duration
        durationInSeconds: 0,
        videoId: videoId
      };
    }
  } catch (error) {
    console.error("Error getting video info:", error);
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
    
    // Get video info
    const videoInfo = await getVideoInfo(videoData.url);
    
    // Extract metadata
    const videoTitle = videoInfo.title || videoData.title || `Audio-${videoId}`;
    const thumbnailUrl = videoInfo.thumbnail || videoData.thumbnail || '';
    const duration = videoInfo.duration || videoData.duration || '';
    const durationInSeconds = videoInfo.durationInSeconds || videoData.durationInSeconds || 0;
    const artist = videoInfo.author || videoData.author || 'Unknown';
    
    // Method 1: Try using ytdl-core with appropriate options
    try {
      // Use more browser-like request headers
      const options = {
        quality: 'highestaudio',
        filter: 'audioonly',
        requestOptions: {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            'Connection': 'keep-alive',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'none',
            'Sec-Fetch-User': '?1',
            'Upgrade-Insecure-Requests': '1'
          }
        }
      };
      
      // First get the video info with our custom headers
      const info = await ytdl.getInfo(videoData.url, {
        requestOptions: options.requestOptions
      });
      
      // Get the formats
      const formats = ytdl.filterFormats(info.formats, 'audioonly');
      
      if (formats.length === 0) {
        throw new Error('No audio formats available');
      }
      
      // Get the stream
      const stream = ytdl.downloadFromInfo(info, options);
      
      // Convert to MP3
      await new Promise((resolve, reject) => {
        ffmpeg(stream)
          .audioBitrate(128)
          .format('mp3')
          .on('error', (err) => {
            console.error('FFmpeg error:', err);
            reject(err);
          })
          .on('end', resolve)
          .save(outputPath);
      });
    } catch (ytdlError) {
      console.error('ytdl-core download failed:', ytdlError);
      
      // Method 2: Fallback to direct format URL if available
      if (videoInfo.formats && videoInfo.formats.length > 0) {
        // Find audio format
        const audioFormats = videoInfo.formats.filter(f => f.mimeType && f.mimeType.includes('audio/'));
        
        if (audioFormats.length > 0) {
          // Sort by quality (audio bitrate)
          audioFormats.sort((a, b) => (b.audioBitrate || 0) - (a.audioBitrate || 0));
          
          // Get the highest quality audio URL
          const audioUrl = audioFormats[0].url;
          
          // Download the audio file
          const response = await axios({
            method: 'GET',
            url: audioUrl,
            responseType: 'stream',
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            }
          });
          
          // Convert to MP3
          await new Promise((resolve, reject) => {
            ffmpeg(response.data)
              .audioBitrate(128)
              .format('mp3')
              .on('error', (err) => {
                console.error('FFmpeg error in direct format URL:', err);
                reject(err);
              })
              .on('end', resolve)
              .save(outputPath);
          });
        } else {
          throw new Error('No audio formats found');
        }
      } else {
        // Method 3: Use a third-party API (you would need to implement this)
        throw new Error('All download methods failed');
      }
    }
    
    // Check if file exists and has content
    if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size === 0) {
      throw new Error('Failed to generate audio file');
    }
    
    // Upload the audio file to Cloudinary
    const cloudinaryResult = await uploadToCloudinary(outputPath);
    
    // Delete the temporary file
    try {
      fs.unlinkSync(outputPath);
    } catch (deleteError) {
      console.warn("Couldn't delete temp file:", deleteError.message);
    }
    
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