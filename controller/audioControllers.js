import { v2 as cloudinary } from 'cloudinary';
import ytdl from 'youtube-dl-exec';
import fs from 'fs';
import path from 'path';

// Konfigurasi Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUD_NAME,
  api_key: process.env.API_KEY,
  api_secret: process.env.API_SECRET,
});

// Controller utama
export const convertVideoToAudio = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { videoUrl } = req.body;
  if (!videoUrl) {
    return res.status(400).json({ error: 'Video URL is required' });
  }

  try {
    // Unduh video sementara
    const filePath = '/tmp/video.mp4';

    const output = fs.createWriteStream(filePath);
    const videoStream = ytdl(videoUrl, {
      format: 'bestaudio',
    });

    videoStream.pipe(output);

    output.on('finish', async () => {
      try {
        // Upload ke Cloudinary dan konversi otomatis ke MP3
        const result = await cloudinary.uploader.upload(filePath, {
          resource_type: 'video',
          eager: [
            { format: 'mp3' } // Cloudinary akan otomatis convert ke MP3
          ],
          eager_async: false,
        });

        // Ambil URL hasil convert MP3
        const mp3Url = result.eager?.[0]?.secure_url;

        // Hapus file lokal
        fs.unlinkSync(filePath);

        return res.status(200).json({ message: 'Sukses', mp3Url });
      } catch (uploadErr) {
        console.error('Upload error:', uploadErr);
        return res.status(500).json({ error: 'Gagal upload dan convert' });
      }
    });

    output.on('error', (err) => {
      console.error('Download error:', err);
      return res.status(500).json({ error: 'Gagal unduh video' });
    });
  } catch (err) {
    console.error('Unexpected error:', err);
    return res.status(500).json({ error: 'Terjadi kesalahan' });
  }
};
