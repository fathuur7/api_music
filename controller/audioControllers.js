// api/convert.js
import ytdl from 'ytdl-core';  // Hapus tanda kurung
import { v2 as cloudinary } from 'cloudinary';  // Perlu destructuring yang benar

// Konfigurasi Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUD_NAME,
  api_key: process.env.API_KEY,
  api_secret: process.env.API_SECRET
});

// Fungsi untuk menangani stream dan upload langsung ke Cloudinary
const streamToCloudinary = async (ytStream, format) => {
  return new Promise((resolve, reject) => {
    // Buat writeable stream untuk Cloudinary
    const cloudinaryStream = cloudinary.uploader.upload_stream(
      {
        resource_type: 'video',
        format: format,
        public_id: 'mp3_upload_' + Date.now()
      },
      (error, result) => {
        if (error) {
          return reject(error);
        }
        resolve(result);
      }
    );

    // Pipe langsung dari YouTube ke Cloudinary (tanpa menyimpan di disk)
    ytStream.pipe(cloudinaryStream);
  });
};

export const convertVideoToAudio = async (req, res) => {
  const { url } = req.body;
  
  if (!url || !ytdl.validateURL(url)) {
    return res.status(400).json({ error: 'URL tidak valid' });
  }

  try {
    // Dapatkan audio stream dari YouTube dengan kualitas tertinggi
    const audioStream = ytdl(url, { 
      filter: 'audioonly',
      quality: 'highestaudio' 
    });

    // Upload langsung ke Cloudinary
    const result = await streamToCloudinary(audioStream, 'mp3');
    
    return res.json({ 
      success: true, 
      url: result.secure_url,
      filename: result.public_id
    });
  } catch (err) {
    console.error('Error:', err);
    return res.status(500).json({ 
      error: 'Terjadi kesalahan saat proses',
      message: err.message 
    });
  }
};