import youtubeDl from 'youtube-dl-exec';
import ytdl from 'ytdl-core';
import ffmpeg from 'fluent-ffmpeg';
import path from 'path';
import Audio from '../models/audio.js';
import os from 'os';
import fs from 'fs';
import { v2 as cloudinary } from 'cloudinary';

// Configure Cloudinary
cloudinary.config({ 
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME, 
  api_key: process.env.CLOUDINARY_API_KEY, 
  api_secret: process.env.CLOUDINARY_API_SECRET,
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
    
    let videoTitle = videoData.title || `Audio-${videoId}`;
    let thumbnailUrl = videoData.thumbnail || '';
    let duration = videoData.duration || '';
    let durationInSeconds = videoData.durationInSeconds || 0;
    let artist = videoData.author || 'Unknown';

    // Try method 1: ytdl-core
    try {
      const info = await ytdl.getInfo(videoData.url);
      videoTitle = info.videoDetails.title;
      thumbnailUrl = info.videoDetails.thumbnails[0].url;
      duration = info.videoDetails.lengthSeconds;
      durationInSeconds = parseInt(info.videoDetails.lengthSeconds);
      artist = info.videoDetails.author.name;
      
      const stream = ytdl(videoData.url, { 
        quality: 'highestaudio',
        filter: 'audioonly'
      });
      
      await new Promise((resolve, reject) => {
        ffmpeg(stream)
          .audioBitrate(128)
          .format('mp3')
          .on('error', reject)
          .on('end', resolve)
          .save(outputPath);
      });
    } 
    // If ytdl-core fails, use youtube-dl as fallback
    catch (ytdlError) {
      console.log("ytdl-core failed, trying youtube-dl-exec instead:", ytdlError.message);
      
      await youtubeDl(videoData.url, {
        extractAudio: true,
        audioFormat: 'mp3',
        audioQuality: 0, // 0 is highest quality
        output: outputPath
      });
      
      // Get video info using youtube-dl-exec
      const videoInfo = await youtubeDl(videoData.url, {
        dumpSingleJson: true,
        noWarnings: true,
        noCallHome: true,
        preferFreeFormats: true,
        youtubeSkipDashManifest: true,
      });
      
      if (videoInfo) {
        videoTitle = videoInfo.title || videoTitle;
        thumbnailUrl = videoInfo.thumbnail || thumbnailUrl;
        duration = videoInfo.duration_string || duration;
        durationInSeconds = videoInfo.duration || durationInSeconds;
        artist = videoInfo.uploader || artist;
      }
    }
    
    // Upload the audio file to Cloudinary
    const cloudinaryResult = await uploadToCloudinary(outputPath);
    
    // Delete the temporary file
    try {
      fs.unlinkSync(outputPath);
    } catch (deleteError) {
      // Just log if we can't delete, doesn't affect functionality
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
    console.error('Error:', error);
    res.status(500).json({ success: false, message: 'Gagal memproses video', error: error.message });
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
    
    // Path for temporary output file in OS temp directory
    const outputFilename = `${videoId}-${quality}.${format}`;
    const outputPath = getTempFilePath(outputFilename);
    
    // Use ytdl to download with requested format/quality
    const ytdlOptions = {
      quality: quality === 'high' ? 'highestaudio' : 'lowestaudio',
      filter: 'audioonly'
    };
    
    try {
      const stream = ytdl(audio.originalUrl, ytdlOptions);
      
      // Set bit rate based on quality
      const bitrate = quality === 'high' ? 320 : (quality === 'medium' ? 192 : 128);
      
      // Use ffmpeg to convert to requested format with specified quality
      await new Promise((resolve, reject) => {
        ffmpeg(stream)
          .audioBitrate(bitrate)
          .format(format)
          .on('error', reject)
          .on('end', resolve)
          .save(outputPath);
      });
      
      // Upload to Cloudinary
      const cloudinaryResult = await uploadToCloudinary(outputPath, 'youtube-audios-custom');
      
      // Clean up temporary file
      try {
        fs.unlinkSync(outputPath);
      } catch (deleteError) {
        console.warn("Couldn't delete temp file:", deleteError.message);
      }
      
      // Redirect to the download URL
      const downloadUrl = cloudinaryResult.secure_url + "?fl_attachment=true";
      res.redirect(downloadUrl);
      
    } catch (ytdlError) {
      console.error('Error downloading with ytdl:', ytdlError);
      
      // Fallback to existing file
      const downloadUrl = audio.audioUrl + "?fl_attachment=true";
      res.redirect(downloadUrl);
    }
    
  } catch (error) {
    console.error('Error:', error);
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