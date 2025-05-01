// controller/audioControllers.js
import { video_info, stream } from 'play-dl';
import { v2 as cloudinary } from 'cloudinary';

// Konfigurasi Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUD_NAME,
  api_key: process.env.API_KEY,
  api_secret: process.env.API_SECRET
});

// Fungsi untuk menangani stream dan upload langsung ke Cloudinary
const streamToCloudinary = async (audioStream, format) => {
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
    audioStream.pipe(cloudinaryStream);
  });
};

// Controller untuk konversi video YouTube ke audio
export const convertVideoToAudio = async (req, res) => {
  const { url } = req.body;
  
  if (!url) {
    return res.status(400).json({ error: 'URL tidak valid' });
  }

  try {
    // Validasi dan dapatkan informasi video
    const videoInfo = await video_info(url);
    
    if (!videoInfo) {
      return res.status(400).json({ error: 'Tidak dapat mengambil informasi video' });
    }
    
    // Dapatkan stream audio terbaik
    const audioStream = await stream(url, { 
      quality: 140, // Format audio m4a 128 kbps
      discordPlayerCompatibility: false
    });
    
    if (!audioStream) {
      return res.status(400).json({ error: 'Tidak dapat membuat audio stream' });
    }
    
    // Upload langsung ke Cloudinary
    const result = await streamToCloudinary(audioStream.stream, 'mp3');
    
    // Di sini Anda bisa menyimpan hasil ke database jika diperlukan
    // Misalnya: await Audio.create({ ... })
    
    return res.status(200).json({
      success: true,
      title: videoInfo.video_details.title,
      url: result.secure_url,
      filename: result.public_id,
      duration: videoInfo.video_details.durationInSec
    });
    
  } catch (error) {
    console.error('Error:', error);
    return res.status(500).json({
      error: 'Terjadi kesalahan saat memproses video',
      message: error.message
    });
  }
};

