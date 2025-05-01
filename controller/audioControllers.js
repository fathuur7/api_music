import { v2 as cloudinary } from 'cloudinary';
import ytdl from 'youtube-dl-exec';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import { exec } from 'child_process';

// Promisify exec for async/await usage
const execAsync = promisify(exec);

// Cloudinary Configuration
cloudinary.config({
  cloud_name: process.env.CLOUD_NAME,
  api_key: process.env.API_KEY,
  api_secret: process.env.API_SECRET,
});

// Main Controller
export const convertVideoToAudio = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { videoUrl } = req.body;
  if (!videoUrl) {
    return res.status(400).json({ error: 'Video URL is required' });
  }

  try {
    const filePath = '/tmp/video.mp4';
    
    // Use youtube-dl-exec to download the video
    // The exec method returns a promise that resolves when the download is complete
    await ytdl.exec(videoUrl, {
      output: filePath,
      extractAudio: true,
      audioFormat: 'mp3',
      noCheckCertificate: true,
      noWarnings: true,
      preferFreeFormats: true,
      addHeader: ['referer:youtube.com', 'user-agent:Mozilla/5.0'],
    });

    // Upload to Cloudinary after download is complete
    const result = await cloudinary.uploader.upload(filePath, {
      resource_type: 'video',
      eager: [
        { format: 'mp3' }
      ],
      eager_async: false,
    });

    // Get the MP3 URL from the conversion
    const mp3Url = result.eager?.[0]?.secure_url;

    // Delete the local file
    fs.unlinkSync(filePath);

    return res.status(200).json({ message: 'Success', mp3Url });
    
  } catch (err) {
    console.error('Unexpected error:', err);
    return res.status(500).json({ error: 'An error occurred', details: err.message });
  }
};