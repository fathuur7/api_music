import ytdl from 'ytdl-core';
import { createWriteStream, unlink } from 'fs';
import { promisify } from 'util';
import path from 'path';
import os from 'os';
import { v2 as cloudinary } from 'cloudinary';

// Konfigurasi Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUD_NAME,
  api_key: process.env.API_KEY,
  api_secret: process.env.API_SECRET
});

const unlinkAsync = promisify(unlink);

export const convertAndUpload = async (req, res) => {
  const { url } = req.body;

  if (!url || !ytdl.validateURL(url)) {
    return res.status(400).json({ error: 'URL YouTube tidak valid.' });
  }

  try {
    const info = await ytdl.getInfo(url);
    const title = info.videoDetails.title.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 30);
    const tempPath = path.join(os.tmpdir(), `${Date.now()}_${title}.mp3`);

    const audioStream = ytdl(url, {
      quality: 'highestaudio',
      filter: 'audioonly'
    });

    const fileStream = createWriteStream(tempPath);

    audioStream.pipe(fileStream);

    fileStream.on('finish', async () => {
      try {
        const uploadResult = await cloudinary.uploader.upload(tempPath, {
          resource_type: 'video',
          public_id: `yt_audio_${Date.now()}_${title}`
        });

        await unlinkAsync(tempPath); // Bersihkan file lokal

        res.status(200).json({
          success: true,
          cloudinaryUrl: uploadResult.secure_url,
          publicId: uploadResult.public_id,
          title: info.videoDetails.title,
          duration: info.videoDetails.lengthSeconds,
          thumbnail: info.videoDetails.thumbnails.at(-1).url
        });
      } catch (err) {
        await unlinkAsync(tempPath);
        console.error('Upload error:', err);
        res.status(500).json({ error: 'Gagal upload ke Cloudinary', message: err.message });
      }
    });

    audioStream.on('error', (err) => {
      console.error('Stream error:', err);
      res.status(500).json({ error: 'Gagal mendownload audio', message: err.message });
    });

    fileStream.on('error', (err) => {
      console.error('File write error:', err);
      res.status(500).json({ error: 'Gagal menyimpan file sementara', message: err.message });
    });

  } catch (err) {
    console.error('General error:', err);
    res.status(500).json({ error: 'Terjadi kesalahan saat memproses', message: err.message });
  }
};
