import { execFile } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { promisify } from 'util';
import { v2 as cloudinary } from 'cloudinary';
import dotenv from 'dotenv';

dotenv.config();
const execFileAsync = promisify(execFile);

// Cloudinary configuration
cloudinary.config({
  cloud_name: process.env.CLOUD_NAME,
  api_key: process.env.API_KEY,
  api_secret: process.env.API_SECRET,
});

console.log('Cloudinary config:', {
  cloud_name: process.env.CLOUD_NAME,
  api_key: process.env.API_KEY,
  api_secret: process.env.API_SECRET
});

export const convertVideoToAudio = async (req, res) => {
  try {
    const { videoUrl } = req.body;
    if (!videoUrl || !videoUrl.startsWith('http')) {
      return res.status(400).json({ success: false, message: 'Invalid YouTube URL' });
    }

    // Create a specific directory for downloads
    const downloadDir = path.join(os.tmpdir(), 'youtube-downloads', `download-${Date.now()}`);
    if (!fs.existsSync(downloadDir)) {
      fs.mkdirSync(downloadDir, { recursive: true });
    }
    
    const outputTemplate = path.join(downloadDir, '%(title)s.%(ext)s');

    console.log(`Processing YouTube URL: ${videoUrl}`);
    console.log(`Output template: ${outputTemplate}`);

    // Run yt-dlp to download audio
    const { stdout, stderr } = await execFileAsync('yt-dlp', [
      '-f', 'bestaudio',
      '--extract-audio',
      '--audio-format', 'mp3',
      '--force-overwrites',
      '-o', outputTemplate,
      videoUrl,
    ]);

    console.log('yt-dlp output:', stdout || stderr);

    // Find the newly created MP3 file
    const mp3Files = fs.readdirSync(downloadDir)
      .filter(name => name.endsWith('.mp3'))
      .map(name => path.join(downloadDir, name));

    console.log(`Found ${mp3Files.length} mp3 files in download directory:`, mp3Files);
    
    if (mp3Files.length === 0) {
      return res.status(500).json({ 
        success: false, 
        message: 'No audio files found after conversion'
      });
    }

    // Filter out empty files and sort by file size (largest first)
    const validMp3Files = mp3Files
      .filter(file => {
        const size = fs.statSync(file).size;
        console.log(`File ${file}: ${size} bytes`);
        return size > 0;
      })
      .sort((a, b) => fs.statSync(b).size - fs.statSync(a).size);
      
    if (validMp3Files.length === 0) {
      return res.status(500).json({ 
        success: false, 
        message: 'No non-empty audio files found after conversion'
      });
    }
    
    let mp3Path = validMp3Files[0];
    console.log(`Selected mp3 file: ${mp3Path}`);
    
    // Check if file exists and has content
    if (!fs.existsSync(mp3Path)) {
      return res.status(500).json({ 
        success: false, 
        message: 'MP3 file does not exist'
      });
    }
    
    const fileStats = fs.statSync(mp3Path);
    console.log(`File size: ${fileStats.size} bytes`);
    
    if (fileStats.size === 0) {
      return res.status(500).json({ 
        success: false, 
        message: 'MP3 file is empty (0 bytes)'
      });
    }

    const baseName = path.basename(mp3Path, '.mp3');
    const sanitizedTitle = baseName.replace(/[<>:"/\\|?*]+/g, '');

    console.log(`Uploading file to Cloudinary with title: ${sanitizedTitle}`);
    
    // Upload to Cloudinary with additional error handling
    try {
      const uploadResult = await cloudinary.uploader.upload(mp3Path, {
        resource_type: 'auto', // Let Cloudinary detect the type
        public_id: `youtube-audio/${sanitizedTitle}`,
        format: 'mp3',
        overwrite: true,
        timeout: 180000, // 3-minute timeout for larger files
      });

      console.log('Cloudinary upload successful:', uploadResult.secure_url);

      // Clean up - delete the file and attempt to delete the directory
      try {
        fs.unlinkSync(mp3Path);
        fs.rmdirSync(downloadDir, { recursive: true });
      } catch (cleanupError) {
        console.error('Cleanup error (non-fatal):', cleanupError);
      }

      return res.status(200).json({
        success: true,
        message: 'Successfully converted and uploaded',
        data: {
          title: sanitizedTitle,
          url: uploadResult.secure_url,
          public_id: uploadResult.public_id,
          duration: uploadResult.duration || 0,
        },
      });
    } catch (cloudinaryError) {
      console.error('Cloudinary upload error:', cloudinaryError);
      return res.status(500).json({ 
        success: false, 
        message: `Cloudinary upload failed: ${cloudinaryError.message}`,
        details: cloudinaryError
      });
    }
  } catch (error) {
    console.error('Conversion error:', error);
    return res.status(500).json({ 
      success: false, 
      message: `Internal server error: ${error.message}`,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
};