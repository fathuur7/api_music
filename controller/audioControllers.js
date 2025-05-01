import ytdl from 'ytdl-core';
import { createWriteStream, unlink } from 'fs';
import { promisify } from 'util';
import path from 'path';
import os from 'os';
import { v2 as cloudinary } from 'cloudinary';

// Setup cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUD_NAME,
  api_key: process.env.API_KEY,
  api_secret: process.env.API_SECRET
});

const unlinkAsync = promisify(unlink);

export const convertYtToCloudinary = async (url) => {
  if (!ytdl.validateURL(url)) {
    throw new Error('URL YouTube tidak valid.');
  }

  const info = await ytdl.getInfo(url);
  const title = info.videoDetails.title.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 30);
  const tempPath = path.join(os.tmpdir(), `${Date.now()}_${title}.mp3`);

  return new Promise((resolve, reject) => {
    const audioStream = ytdl(url, {
      quality: 'highestaudio',
      filter: 'audioonly'
    });

    const fileStream = createWriteStream(tempPath);

    audioStream.pipe(fileStream);

    fileStream.on('finish', async () => {
      try {
        const result = await cloudinary.uploader.upload(tempPath, {
          resource_type: 'video',
          public_id: `yt_audio_${Date.now()}_${title}`
        });

        await unlinkAsync(tempPath); // delete temp file

        resolve({
          cloudinaryUrl: result.secure_url,
          publicId: result.public_id,
          title: info.videoDetails.title,
          duration: info.videoDetails.lengthSeconds,
          thumbnail: info.videoDetails.thumbnails.at(-1).url
        });
      } catch (err) {
        await unlinkAsync(tempPath); // still cleanup
        reject(err);
      }
    });

    audioStream.on('error', (err) => {
      reject(err);
    });

    fileStream.on('error', (err) => {
      reject(err);
    });
  });
};
