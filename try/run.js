import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { v2 as cloudinary } from 'cloudinary';
import dotenv from 'dotenv';

// Setup __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

// Setup Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUD_NAME,
  api_key: process.env.API_KEY,
  api_secret: process.env.API_SECRET,
});

// Link YouTube
const videoUrl = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';

async function downloadAudio() {
  const outputPath = path.join(__dirname, 'output.mp3');

  return new Promise((resolve, reject) => {
    exec(`yt-dlp -x --audio-format mp3 -o "${outputPath}" "${videoUrl}"`, (error, stdout, stderr) => {
      if (error) {
        console.error('Error downloading audio:', error.message);
        return reject(error);
      }
      console.log('Audio downloaded successfully.');
      resolve(outputPath);
    });
  });
}

async function uploadToCloudinary(filePath) {
  try {
    const result = await cloudinary.uploader.upload(filePath, {
      resource_type: 'video',
      folder: 'youtube_mp3',
      use_filename: true,
      unique_filename: false,
    });
    console.log('Uploaded to Cloudinary:', result.secure_url);
    return result.secure_url;
  } catch (error) {
    console.error('Cloudinary Upload Error:', error);
    throw error;
  }
}

async function main() {
  try {
    const filePath = await downloadAudio();
    const uploadedUrl = await uploadToCloudinary(filePath);

    // Delete local file
    fs.unlinkSync(filePath);
    console.log('Temporary file deleted.');

    console.log('Process completed. File URL:', uploadedUrl);
  } catch (error) {
    console.error('Something went wrong:', error);
  }
}

main();
