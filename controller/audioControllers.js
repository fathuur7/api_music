import youtubeDl from 'youtube-dl-exec';
import ytdl from 'ytdl-core';
import ffmpeg from 'fluent-ffmpeg';
import path from 'path';
import Audio from '../models/audio.js';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { dirname, join } from 'path';


const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);


const uploadsDir = join(__dirname, 'uploads');

// Buat folder untuk menyimpan audio jika belum ada
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir);
}

// Endpoint untuk mengkonversi video YouTube menjadi audio
export const convertVideoToAudio =  async (req, res) => {
  const { videoData } = req.body;
  
  if (!videoData || !videoData.url) {
    return res.status(400).json({ success: false, message: 'URL video tidak ditemukan' });
  }
  
  try {
    // Cek apakah audio sudah ada di database
    const existingAudio = await Audio.findOne({ originalUrl: videoData.url });
    if (existingAudio) {
      return res.json({
        success: true,
        message: 'Audio sudah tersedia',
        audio: existingAudio
      });
    }

    // Extract video ID dari URL
    const videoId = videoData.url.split('v=')[1]?.split('&')[0] || 
                    videoData.url.split('youtu.be/')[1]?.split('?')[0] || 
                    Date.now().toString();
    
    // Path untuk menyimpan audio
    const outputPath = path.join(uploadsDir, `${videoId}.mp3`);
    const audioUrl = `../uploads/${videoId}.mp3`;
    
    let videoTitle = videoData.title || `Audio-${videoId}`;
    let thumbnailUrl = videoData.thumbnail || '';
    let duration = videoData.duration || '';
    let durationInSeconds = videoData.durationInSeconds || 0;
    let artist = videoData.author || 'Unknown';

    // Coba metode 1: ytdl-core
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
    // Jika ytdl-core gagal, gunakan youtube-dl sebagai fallback
    catch (ytdlError) {
      console.log("ytdl-core failed, trying youtube-dl-exec instead:", ytdlError.message);
      
      await youtubeDl(videoData.url, {
        extractAudio: true,
        audioFormat: 'mp3',
        audioQuality: 0, // 0 adalah kualitas tertinggi
        output: outputPath
      });
      
      // Ambil informasi video menggunakan youtube-dl-exec
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
    
    // Simpan data audio ke database
    const newAudio = new Audio({
      title: videoTitle,
      originalUrl: videoData.url,
      audioUrl: audioUrl,
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
}

// Endpoint untuk mendapatkan semua audio yang tersimpan
export const GetAllAudios = async (req, res) => {
  try {
    const audios = await Audio.find().sort({ createdAt: -1 });
    res.json({ success: true, audios });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Gagal mengambil data audio', 
      at : 'getAllAudios',
      error: error.message });
  }
}

// Endpoint untuk mendapatkan audio berdasarkan ID
export const GetAudioById = async (req, res) => {
  try {
    const audio = await Audio.findById(req.params.id);
    if (!audio) {
      return res.status(404).json({ success: false, message: 'Audio tidak ditemukan' });
    }
    res.json({ success: true, audio });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Gagal mengambil data audio', error: error.message,
      at : 'getAudioById'
    });
  }
}


// Endpoint untuk mendownload audio berdasarkan ID
export const DownloadAudioById = async (req, res) => {
  try {
    // Cari audio berdasarkan ID
    const audio = await Audio.findById(req.params.id);
    if (!audio) {
      return res.status(404).json({ success: false, message: 'Audio tidak ditemukan' });
    }
    
    // Dapatkan path file audio

    const audioPath = path.join(__dirname, "/uploads", `${audio.audioUrl}`);
    
    console.log('Audio path:', audioPath);
    // Periksa apakah folder uploads ada
    if (!fs.existsSync(uploadsDir)) {
      return res.status(500).json({
        success: false,
        message: 'Folder uploads tidak ditemukan di server',
        at: 'downloadAudioById'
      });
    }
    
    // Periksa apakah file exist
    if (!fs.existsSync(audioPath)) {
      return res.status(404).json({ 
        success: false, 
        message: 'File audio tidak ditemukan di server',
        at: 'downloadAudioById'
      });
    }

    // Set header untuk download
    const filename = encodeURIComponent(audio.title + '.mp3');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'audio/mpeg');
    
    // Stream file ke response
    const fileStream = fs.createReadStream(audioPath);
    fileStream.pipe(res);
    
    // Handle error streaming
    fileStream.on('error', (error) => {
      console.error('Error streaming file:', error);
      if (!res.headersSent) {
        res.status(500).json({ 
          success: false, 
          message: 'Gagal streaming file audio', 
          error: error.message,
          at: 'downloadAudioById'
        });
      }
    });
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

// Fungsi untuk download audio dengan format dan kualitas tertentu
export const DownloadAudioWithOptions = async (req, res) => {
  try {
    const { id } = req.params;
    const { format = 'mp3', quality = 'high' } = req.query;
    
    // Cari audio berdasarkan ID
    const audio = await Audio.findById(id);
    if (!audio) {
      return res.status(404).json({ success: false, message: 'Audio tidak ditemukan' });
    }
    
    // Path untuk file output
    const outputFilename = `${audio.title.replace(/[<>:"/\\|?*]+/g, '')}-${quality}.${format}`;
    const outputPath = path.join(uploadsDir, outputFilename);
    
    // Gunakan ytdl untuk mendownload ulang dengan format/kualitas yang diminta
    const ytdlOptions = {
      quality: quality === 'high' ? 'highestaudio' : 'lowestaudio',
      filter: 'audioonly'
    };
    
    try {
      const stream = ytdl(audio.originalUrl, ytdlOptions);
      
      // Set bit rate berdasarkan kualitas
      const bitrate = quality === 'high' ? 320 : (quality === 'medium' ? 192 : 128);
      
      // Use ffmpeg to convert to requested format with specified quality
      const ffmpegProcess = new Promise((resolve, reject) => {
        ffmpeg(stream)
          .audioBitrate(bitrate)
          .format(format)
          .on('error', (err) => reject(err))
          .on('end', () => resolve())
          .save(outputPath);
      });
      
      await ffmpegProcess;
      
      // Set header for download
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(outputFilename)}"`);
      res.setHeader('Content-Type', format === 'mp3' ? 'audio/mpeg' : 'audio/ogg');
      
      // Stream file to response
      const fileStream = fs.createReadStream(outputPath);
      fileStream.pipe(res);
      
      // Clean up the temporary file after streaming
      fileStream.on('end', () => {
        fs.unlink(outputPath, (err) => {
          if (err) console.error('Error deleting temporary file:', err);
        });
      });
      
      fileStream.on('error', (error) => {
        console.error('Error streaming file:', error);
        if (!res.headersSent) {
          res.status(500).json({ success: false, message: 'Gagal streaming file audio', error: error.message });
        }
      });
      
    } catch (ytdlError) {
      console.error('Error downloading with ytdl:', ytdlError);
      
      // Fallback to existing file if download fails
      const fallbackPath = path.join(__dirname, '..', audio.audioUrl);
      
      if (fs.existsSync(fallbackPath)) {
        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(audio.title)}.mp3"`);
        res.setHeader('Content-Type', 'audio/mpeg');
        fs.createReadStream(fallbackPath).pipe(res);
      } else {
        throw new Error('Gagal mengunduh audio dan file backup tidak tersedia');
      }
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

// Endpoint untuk melacak progress download
export const TrackDownloadProgress = async (req, res) => {
  const { id } = req.params;
  
  try {
    const audio = await Audio.findById(id);
    if (!audio) {
      return res.status(404).json({ success: false, message: 'Audio tidak ditemukan' });
    }
    
    // Implementasi SSE (Server-Sent Events) untuk streaming progress
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    
    const downloadId = Date.now().toString();
    let progress = 0;
    
    // Simpan referensi ke interval
    const progressInterval = setInterval(() => {
      // Simulasi progress (dalam implementasi nyata, ini akan mengambil dari status download sebenarnya)
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