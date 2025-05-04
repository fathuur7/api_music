import { execFile } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { promisify } from 'util';
import { v2 as cloudinary } from 'cloudinary';
import ffmpegPath from 'ffmpeg-static';
import dotenv from 'dotenv';

dotenv.config();
const execFileAsync = promisify(execFile);

// Cloudinary configuration
cloudinary.config({
  cloud_name: process.env.CLOUD_NAME,
  api_key: process.env.API_KEY,
  api_secret: process.env.API_SECRET,
});

export const convertVideoToAudio = async (req, res) => {
  try {
    const { videoUrl } = req.body;
    if (!videoUrl || !videoUrl.startsWith('http')) {
      return res.status(400).json({ success: false, message: 'Invalid YouTube URL' });
    }

    const tempDir = os.tmpdir();
    const outputTemplate = path.join(tempDir, '%(title).80s.%(ext)s');

    console.log(`Processing YouTube URL: ${videoUrl}`);
    console.log(`Output template: ${outputTemplate}`);

    // Run yt-dlp to download audio with force download option
    const { stdout, stderr } = await execFileAsync('yt-dlp', [
      '-f', 'bestaudio',
      '--extract-audio',
      '--audio-format', 'mp3',
      '--force-overwrites', // Force overwrite existing files
      '-o', outputTemplate,
      '--ffmpeg-location', ffmpegPath,
      videoUrl,
    ]);

    console.log('yt-dlp output:', stdout || stderr);

    // Find the newly created MP3 file
    const mp3Files = fs.readdirSync(tempDir)
      .filter(name => name.endsWith('.mp3'))
      .map(name => path.join(tempDir, name));

    console.log(`Found ${mp3Files.length} mp3 files in temp directory:`, mp3Files);
    
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
    
    // Look for the file mentioned in the yt-dlp output first
    const ytdlpOutput = stdout || stderr || '';
    const mentionedFiles = mp3Files.filter(file => ytdlpOutput.includes(file));
    
    let mp3Path = mentionedFiles.length > 0 && fs.statSync(mentionedFiles[0]).size > 0
      ? mentionedFiles[0]
      : validMp3Files[0];
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

    // Ensure the file is readable before uploading
    try {
      // Read a small portion of the file to verify it's readable
      const fd = fs.openSync(mp3Path, 'r');
      const buffer = Buffer.alloc(1024);
      fs.readSync(fd, buffer, 0, 1024, 0);
      fs.closeSync(fd);
    } catch (error) {
      return res.status(500).json({ 
        success: false, 
        message: `Cannot read the MP3 file: ${error.message}`
      });
    }

    console.log(`Uploading file to Cloudinary with title: ${sanitizedTitle}`);
    
    // Upload to Cloudinary with additional error handling
    try {
      const uploadResult = await cloudinary.uploader.upload(mp3Path, {
        resource_type: 'auto', // Let Cloudinary detect the type
        public_id: `youtube-audio/${sanitizedTitle}`,
        format: 'mp3',
        overwrite: true,
        timeout: 120000, // 2-minute timeout for larger files
      });

      console.log('Cloudinary upload successful:', uploadResult.secure_url);

      // Delete local file after successful upload
      fs.unlinkSync(mp3Path);

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

/**
 * Convert .webm to MP3 using ffmpeg
 * Note: This function remains as a fallback but isn't being used in the main flow
 */
async function convertWebmToMp3(webmFilePath) {
  const mp3FilePath = webmFilePath.replace('.webm', '.mp3');

  return new Promise((resolve, reject) => {
    const ffmpeg = require('fluent-ffmpeg');
    ffmpeg(webmFilePath)
      .audioBitrate(128)
      .format('mp3')
      .on('end', () => resolve(mp3FilePath))
      .on('error', reject)
      .save(mp3FilePath);
  });
}