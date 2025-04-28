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

// Fungsi yang ditingkatkan untuk mendapatkan info video
const getVideoInfo = async (videoUrl) => {
  try {
    // Ekstrak ID video
    const videoId = extractVideoId(videoUrl);
    
    if (!videoId) throw new Error('URL YouTube tidak valid');
    
    // Metode 1: Gunakan ytdl-core
    try {
      console.log("Mendapatkan info dengan ytdl-core...");
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
      console.log("ytdl-core gagal mendapatkan info:", ytdlError.message);
      
      // Metode 2: Coba dengan versi ytdl yang berbeda
      try {
        console.log("Mencoba cara alternatif untuk mendapatkan info...");
        
        // Coba mendapatkan info dengan oembed API YouTube
        const response = await axios.get(`https://www.youtube.com/oembed?url=${videoUrl}&format=json`);
        
        // Coba dapatkan thumbnail dengan resolusi terbaik
        const thumbnailUrl = `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`;
        
        return {
          title: response.data.title,
          thumbnail: thumbnailUrl,
          author: response.data.author_name,
          duration: "Unknown",
          durationInSeconds: 0,
          videoId
        };
      } catch (oembedError) {
        console.log("YouTube oEmbed API gagal:", oembedError.message);
        
        // Metode 3: Gunakan cara paling dasar dengan ID video
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
    console.error("Error mendapatkan info video:", error.message);
    throw error;
  }
};

// Fungsi untuk ekstrak ID video secara lebih komprehensif
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

// Perbaikan untuk fungsi downloadAudio
// Modified downloadAudio function with a fallback that doesn't require FFmpeg
const downloadAudio = async (videoUrl, videoInfo, outputPath) => {
  console.log("Memulai proses download audio...");
  
  // Check if FFmpeg is available
  const ffmpegAvailable = await commandExists('ffmpeg').catch(() => false);
  
  if (!ffmpegAvailable) {
    console.log("FFmpeg tidak tersedia, menggunakan metode direct download...");
    return await downloadAudioWithoutFFmpeg(videoUrl, videoInfo, outputPath);
  }
  
  // Original method 1: Use ytdl-core with better configuration
  try {
    console.log("Mencoba dengan ytdl-core dan konfigurasi yang dioptimalkan...");
    
    // Robust configuration for ytdl-core
    const options = {
      quality: 'highestaudio',
      filter: 'audioonly',
      highWaterMark: 1 << 25, // 32MB buffer
      requestOptions: {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36',
          'Accept': '*/*',
          'Accept-Language': 'en-US,en;q=0.9',
          'Connection': 'keep-alive',
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': 'none',
          'Sec-Fetch-User': '?1',
        }
      }
    };
    
    return new Promise((resolve, reject) => {
      // Use stream to handle video
      const stream = ytdl(videoUrl, options);
      
      // Handle errors on stream
      stream.on('error', (err) => {
        console.error("Error pada stream ytdl:", err.message);
        reject(err);
      });
      
      // Set timeout to prevent hanging
      const streamTimeout = setTimeout(() => {
        stream.destroy();
        reject(new Error('Timeout stream setelah 60 detik'));
      }, 60000);
      
      // Use ffmpeg to process stream to MP3
      ffmpeg(stream)
        .audioCodec('libmp3lame')
        .audioBitrate(128)
        .format('mp3')
        .on('start', () => {
          console.log("FFmpeg mulai memproses audio...");
        })
        .on('error', (err) => {
          clearTimeout(streamTimeout);
          console.error('Error FFmpeg:', err.message);
          reject(err);
        })
        .on('end', () => {
          clearTimeout(streamTimeout);
          console.log("Download ytdl-core berhasil!");
          resolve(true);
        })
        .save(outputPath);
    });
  } catch (ytdlError) {
    console.error('Download ytdl-core gagal:', ytdlError.message);
    
    // If ytdl-core fails, try downloading without FFmpeg
    return await downloadAudioWithoutFFmpeg(videoUrl, videoInfo, outputPath);
  }
};

// New function to download audio without requiring FFmpeg
const downloadAudioWithoutFFmpeg = async (videoUrl, videoInfo, outputPath) => {
  try {
    console.log("Mencoba download audio tanpa FFmpeg...");
    
    // Try to get an audio format from the video info
    if (videoInfo.formats && videoInfo.formats.length > 0) {
      // Find audio formats and sort by quality
      const audioFormats = videoInfo.formats
        .filter(f => f.mimeType && f.mimeType.includes('audio/'))
        .sort((a, b) => (b.audioBitrate || 0) - (a.audioBitrate || 0));
      
      // If we have audio formats, use the best one
      if (audioFormats.length > 0) {
        const audioUrl = audioFormats[0].url;
        if (audioUrl) {
          console.log("Format audio ditemukan, mencoba direct download...");
          
          // Download the audio file directly
          const response = await axios({
            method: 'GET',
            url: audioUrl,
            responseType: 'stream',
            timeout: 60000,
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
          });
          
          // Write directly to file without FFmpeg
          return new Promise((resolve, reject) => {
            const writer = fs.createWriteStream(outputPath);
            
            response.data.pipe(writer);
            
            writer.on('finish', () => {
              console.log("Direct download berhasil!");
              resolve(true);
            });
            
            writer.on('error', (err) => {
              console.error("Error menulis file:", err.message);
              reject(err);
            });
          });
        }
      }
    }
    
    // If previous approach fails, try with ytdl direct to file
    console.log("Mencoba dengan ytdl direct download...");
    
    // Try with standard audio format options
    const options = {
      quality: 'highestaudio',
      filter: 'audioonly',
      highWaterMark: 1 << 25,
      requestOptions: {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      }
    };
    
    return new Promise((resolve, reject) => {
      const stream = ytdl(videoUrl, options);
      const writer = fs.createWriteStream(outputPath);
      
      let streamError = null;
      
      stream.on('error', (err) => {
        streamError = err;
        console.error("Error pada stream ytdl:", err.message);
      });
      
      writer.on('error', (err) => {
        console.error("Error menulis file:", err.message);
        reject(err);
      });
      
      writer.on('finish', () => {
        if (streamError) {
          reject(streamError);
        } else {
          console.log("Direct ytdl download berhasil!");
          resolve(true);
        }
      });
      
      // Pipe the stream directly to file
      stream.pipe(writer);
      
      // Set timeout to prevent hanging
      const streamTimeout = setTimeout(() => {
        stream.destroy();
        writer.end();
        reject(new Error('Timeout stream setelah 60 detik'));
      }, 60000);
      
      stream.on('end', () => {
        clearTimeout(streamTimeout);
      });
    });
  } catch (error) {
    console.error("Download tanpa FFmpeg gagal:", error.message);
    
    // One last attempt with a different ytdl configuration
    try {
      console.log("Mencoba dengan konfigurasi ytdl alternatif...");
      
      const altOptions = {
        quality: 'lowestaudio', // Try with lower quality
        filter: format => format.container === 'webm' || format.container === 'mp4',
        highWaterMark: 1 << 24, // 16MB buffer
        requestOptions: {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15'
          }
        }
      };
      
      return new Promise((resolve, reject) => {
        const altStream = ytdl(videoUrl, altOptions);
        const outputFile = fs.createWriteStream(outputPath);
        
        altStream.on('error', (err) => {
          console.error("Error pada stream ytdl alternatif:", err.message);
          reject(err);
        });
        
        outputFile.on('error', (err) => {
          console.error("Error menulis file:", err.message);
          reject(err);
        });
        
        outputFile.on('finish', () => {
          // Check if file has content
          const stats = fs.statSync(outputPath);
          if (stats.size > 0) {
            console.log("Download alternatif berhasil!");
            resolve(true);
          } else {
            reject(new Error("File yang dihasilkan kosong"));
          }
        });
        
        // Direct pipe to file
        altStream.pipe(outputFile);
      });
    } catch (altError) {
      console.error("Semua metode download gagal:", altError.message);
      throw new Error("Semua metode download gagal");
    }
  }
};


// Perbaikan fungsi downloadAudio dengan fokus pada ytdl-core
// Endpoint untuk mengkonversi video YouTube ke audio
export const convertVideoToAudio = async (req, res) => {
  const { videoData } = req.body;
  
  if (!videoData || !videoData.url) {
    return res.status(400).json({ success: false, message: 'URL video tidak ditemukan' });
  }
  
  try {
    console.log("Memproses permintaan untuk URL:", videoData.url);
    
    // Periksa apakah audio sudah ada di database
    const existingAudio = await Audio.findOne({ originalUrl: videoData.url });
    if (existingAudio) {
      console.log("Audio sudah tersedia di database");
      return res.json({
        success: true,
        message: 'Audio sudah tersedia',
        audio: existingAudio
      });
    }

    // Ekstrak ID video dari URL
    const videoId = extractVideoId(videoData.url) || Date.now().toString();
    
    // Path untuk penyimpanan sementara di direktori temp OS
    const outputPath = getTempFilePath(`${videoId}.mp3`);
    
    console.log("Mendapatkan info video untuk:", videoData.url);
    // Dapatkan info video
    const videoInfo = await getVideoInfo(videoData.url);
    console.log("Info video diperoleh:", videoInfo.title);
    
    // Ekstrak metadata
    const videoTitle = videoInfo.title || videoData.title || `Audio-${videoId}`;
    const thumbnailUrl = videoInfo.thumbnail || videoData.thumbnail || '';
    const duration = videoInfo.duration || videoData.duration || '';
    const durationInSeconds = videoInfo.durationInSeconds || videoData.durationInSeconds || 0;
    const artist = videoInfo.author || videoData.author || 'Unknown';
    
    console.log("Memulai proses download...");
    // Coba semua metode download
    await downloadAudio(videoData.url, videoInfo, outputPath);
    
    // Periksa apakah file ada dan memiliki konten
    if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size === 0) {
      throw new Error('Gagal menghasilkan file audio');
    }
    
    console.log("Audio berhasil didownload, mengunggah ke Cloudinary...");
    // Unggah file audio ke Cloudinary
    const cloudinaryResult = await uploadToCloudinary(outputPath);
    console.log("Diunggah ke Cloudinary:", cloudinaryResult.secure_url);
    
    // Hapus file sementara
    try {
      fs.unlinkSync(outputPath);
      console.log("File sementara dihapus");
    } catch (deleteError) {
      console.warn("Tidak dapat menghapus file temp:", deleteError.message);
    }
    
    console.log("Menyimpan data audio ke database...");
    // Simpan data audio ke database
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
    console.log("Audio berhasil disimpan ke database");
    
    res.json({
      success: true,
      message: 'Video berhasil dikonversi ke audio',
      audio: newAudio
    });
      
  } catch (error) {
    console.error('Error mengkonversi video ke audio:', error);
    
    // Berikan pesan error yang lebih spesifik berdasarkan masalah umum
    let errorMessage = 'Gagal memproses video';
    let errorDetail = 'Kesalahan saat mengunduh atau memproses audio';
    let errorCode = 500;
    
    if (error.message.includes('410')) {
      errorMessage = 'YouTube API tidak tersedia (Error 410)';
      errorDetail = 'YouTube telah mengubah API mereka. Coba lagi nanti atau gunakan URL video lain.';
    } else if (error.message.includes('sign in') || error.message.includes('login')) {
      errorMessage = 'Video memerlukan login';
      errorDetail = 'Video ini memerlukan login YouTube dan tidak dapat diunduh.';
      errorCode = 403;
    } else if (error.message.includes('copyright')) {
      errorMessage = 'Masalah hak cipta';
      errorDetail = 'Video ini memiliki pembatasan hak cipta.';
      errorCode = 403;
    } else if (error.message.includes('private')) {
      errorMessage = 'Video bersifat privat';
      errorDetail = 'Video ini dibuat privat oleh pemiliknya dan tidak dapat diakses.';
      errorCode = 403;
    } else if (error.message.includes('tidak valid') || error.message.includes('invalid')) {
      errorMessage = 'URL YouTube tidak valid';
      errorDetail = 'Silakan periksa URL dan coba lagi.';
      errorCode = 400;
    } else if (error.message.includes('Semua metode download gagal')) {
      errorMessage = 'Semua metode download gagal';
      errorDetail = 'Tidak dapat mengunduh audio dari URL yang diberikan dengan metode yang tersedia. Coba URL lain atau coba lagi nanti.';
    }
    
    res.status(errorCode).json({ 
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