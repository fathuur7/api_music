import ytdl from 'ytdl-core';
import ffmpeg from 'fluent-ffmpeg';
import path from 'path';
import Audio from '../models/audio.js';
import os from 'os';
import fs from 'fs';
import { v2 as cloudinary } from 'cloudinary';
import dotenv from 'dotenv';
import axios from 'axios';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
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
        formats: info.formats,
        videoId
      };
    } catch (ytdlError) {
      console.log("ytdl-core failed to get info, using alternative method:", ytdlError.message);
      
      // Alternative method using YouTube's Iframe API data
      try {
        const response = await axios.get(`https://www.youtube.com/oembed?url=${videoUrl}&format=json`);
        
        return {
          title: response.data.title,
          thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
          author: response.data.author_name,
          duration: "Unknown", // Unfortunately this API doesn't provide duration
          durationInSeconds: 0,
          videoId
        };
      } catch (oembedError) {
        console.log("YouTube oEmbed API failed:", oembedError.message);
        
        // Last resort: Use basic info from video ID
        return {
          title: `YouTube Audio - ${videoId}`,
          thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
          author: 'Unknown',
          duration: "Unknown",
          durationInSeconds: 0,
          videoId
        };
      }
    }
  } catch (error) {
    console.error("Error getting video info:", error);
    throw error;
  }
};

// Helper function to check if command exists
const commandExists = async (command) => {
  try {
    await execAsync(`which ${command}`);
    return true;
  } catch {
    return false;
  }
};

// Function to download using yt-dlp if available
const downloadWithYtDlp = async (videoUrl, outputPath) => {
  if (await commandExists('yt-dlp')) {
    await execAsync(`yt-dlp -x --audio-format mp3 -o "${outputPath}" "${videoUrl}"`);
    return true;
  }
  return false;
};

// Function to download using youtube-dl if available
const downloadWithYoutubeDl = async (videoUrl, outputPath) => {
  if (await commandExists('youtube-dl')) {
    await execAsync(`youtube-dl -x --audio-format mp3 -o "${outputPath}" "${videoUrl}"`);
    return true;
  }
  return false;
};

// Function to download using public YouTube to MP3 API
const downloadWithPublicApi = async (videoId, outputPath) => {
  try {
    // Try using public API (need to implement with actual service)
    // This is an example implementation - you would need to use a real service
    // NOTE: Most free public APIs limit usage or have ads, so use with caution
    
    // Example with a fictional API:
    const apiUrl = `https://youtube-mp3-download-api.example.com/dl?id=${videoId}`;
    
    const response = await axios.get(apiUrl);
    
    if (response.data && response.data.link) {
      // Download from the provided link
      const fileResponse = await axios({
        method: 'get',
        url: response.data.link,
        responseType: 'stream'
      });
      
      const writer = fs.createWriteStream(outputPath);
      
      return new Promise((resolve, reject) => {
        fileResponse.data.pipe(writer);
        writer.on('finish', () => resolve(true));
        writer.on('error', () => reject(false));
      });
    }
    
    return false;
  } catch (error) {
    console.error("API download failed:", error.message);
    return false;
  }
};

// Try downloading directly using audio format URL from ytdl-core info
const downloadWithDirectUrl = async (videoInfo, outputPath) => {
  try {
    if (!videoInfo.formats || videoInfo.formats.length === 0) {
      return false;
    }
    
    // Find audio format
    const audioFormats = videoInfo.formats.filter(f => f.mimeType && f.mimeType.includes('audio/'));
    
    if (audioFormats.length === 0) {
      return false;
    }
    
    // Sort by quality (audio bitrate)
    audioFormats.sort((a, b) => (b.audioBitrate || 0) - (a.audioBitrate || 0));
    
    // Get the highest quality audio URL
    const audioUrl = audioFormats[0].url;
    
    if (!audioUrl) {
      return false;
    }
    
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
    return new Promise((resolve, reject) => {
      ffmpeg(response.data)
        .audioBitrate(128)
        .format('mp3')
        .on('error', (err) => {
          console.error('FFmpeg error in direct format URL:', err);
          resolve(false);
        })
        .on('end', () => resolve(true))
        .save(outputPath);
    });
  } catch (error) {
    console.error("Direct URL download failed:", error.message);
    return false;
  }
};

// Multi-method downloader that tries different approaches
const downloadAudio = async (videoUrl, videoInfo, outputPath) => {
  console.log("Attempting download with multiple methods...");
  
  // Method 1: Try ytdl-core with improved options
  try {
    console.log("Trying ytdl-core with improved options...");
    const options = {
      quality: 'highestaudio',
      filter: 'audioonly', 
      highWaterMark: 1 << 25, // 32MB buffer
      requestOptions: {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/107.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'Cookie': '', // Optional: You could rotate cookies if needed
          'Connection': 'keep-alive',
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': 'none',
          'Sec-Fetch-User': '?1',
          'Upgrade-Insecure-Requests': '1'
        }
      }
    };
    
    const stream = ytdl(videoUrl, options);
    
    await new Promise((resolve, reject) => {
      ffmpeg(stream)
        .audioBitrate(128)
        .format('mp3')
        .on('error', (err) => {
          console.error('FFmpeg error with ytdl-core:', err);
          reject(err);
        })
        .on('end', resolve)
        .save(outputPath);
    });
    
    console.log("ytdl-core download successful!");
    return true;
  } catch (ytdlError) {
    console.error('ytdl-core download failed:', ytdlError.message);
    
    // Method 2: Try direct URL if available
    console.log("Trying direct format URL download...");
    const directUrlSuccess = await downloadWithDirectUrl(videoInfo, outputPath);
    
    if (directUrlSuccess) {
      console.log("Direct URL download successful!");
      return true;
    }
    
    // Method 3: Try yt-dlp if available
    console.log("Trying yt-dlp download...");
    try {
      const ytDlpSuccess = await downloadWithYtDlp(videoUrl, outputPath);
      
      if (ytDlpSuccess) {
        console.log("yt-dlp download successful!");
        return true;
      }
    } catch (ytDlpError) {
      console.error("yt-dlp download failed:", ytDlpError.message);
    }
    
    // Method 4: Try youtube-dl if available
    console.log("Trying youtube-dl download...");
    try {
      const youtubeDlSuccess = await downloadWithYoutubeDl(videoUrl, outputPath);
      
      if (youtubeDlSuccess) {
        console.log("youtube-dl download successful!");
        return true;
      }
    } catch (youtubeDlError) {
      console.error("youtube-dl download failed:", youtubeDlError.message);
    }
    
    // Method 5: Try public API service
    console.log("Trying public API download...");
    try {
      const apiSuccess = await downloadWithPublicApi(videoInfo.videoId, outputPath);
      
      if (apiSuccess) {
        console.log("Public API download successful!");
        return true;
      }
    } catch (apiError) {
      console.error("Public API download failed:", apiError.message);
    }
    
    // All methods failed
    throw new Error("All download methods failed");
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
    
    console.log("Starting download process...");
    // Try all download methods
    await downloadAudio(videoData.url, videoInfo, outputPath);
    
    // Check if file exists and has content
    if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size === 0) {
      throw new Error('Failed to generate audio file');
    }
    
    console.log("Audio downloaded, uploading to Cloudinary...");
    // Upload the audio file to Cloudinary
    const cloudinaryResult = await uploadToCloudinary(outputPath);
    console.log("Uploaded to Cloudinary:", cloudinaryResult.secure_url);
    
    // Delete the temporary file
    try {
      fs.unlinkSync(outputPath);
      console.log("Temporary file deleted");
    } catch (deleteError) {
      console.warn("Couldn't delete temp file:", deleteError.message);
    }
    
    console.log("Saving audio to database...");
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
    console.log("Audio saved to database successfully");
    
    res.json({
      success: true,
      message: 'Video berhasil dikonversi ke audio',
      audio: newAudio
    });
      
  } catch (error) {
    console.error('Error converting video to audio:', error);
    
    // Provide more specific error messages based on common issues
    let errorMessage = 'Gagal memproses video';
    let errorDetail = 'Kesalahan saat mengunduh atau memproses audio';
    
    if (error.message.includes('410')) {
      errorMessage = 'YouTube API tidak tersedia (Error 410)';
      errorDetail = 'YouTube telah mengubah API mereka. Coba lagi nanti atau gunakan URL video lain.';
    } else if (error.message.includes('sign in')) {
      errorMessage = 'Video memerlukan login';
      errorDetail = 'Video ini memerlukan login YouTube dan tidak dapat diunduh.';
    } else if (error.message.includes('copyright')) {
      errorMessage = 'Masalah hak cipta';
      errorDetail = 'Video ini memiliki pembatasan hak cipta.';
    } else if (error.message.includes('All download methods failed')) {
      errorMessage = 'Semua metode download gagal';
      errorDetail = 'Tidak dapat mengunduh audio dari URL yang diberikan dengan metode yang tersedia.';
    }
    
    res.status(500).json({ 
      success: false, 
      message: errorMessage, 
      error: error.message,
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