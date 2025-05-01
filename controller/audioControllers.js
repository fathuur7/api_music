import { v2 as cloudinary } from 'cloudinary';
import axios from 'axios';
import fetch from 'node-fetch';

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
    // Option 1: Use Cloudinary's fetch capability to grab remote URLs directly
    // This is the simplest approach if your video platform is supported
    const uploadResult = await cloudinary.uploader.upload(videoUrl, {
      resource_type: 'video',
      eager: [{ format: 'mp3' }],
      eager_async: false,
      fetch_format: 'auto',
    });

    // Get the MP3 URL from the conversion
    const mp3Url = uploadResult.eager?.[0]?.secure_url;

    if (mp3Url) {
      return res.status(200).json({ message: 'Success', mp3Url });
    } else {
      throw new Error('MP3 conversion failed');
    }
  } catch (cloudinaryError) {
    console.error('Cloudinary error:', cloudinaryError);
    
    // If direct upload fails, we can try a fallback approach using a third-party API
    try {
      // Option 2: Use a third-party API service that provides YouTube to MP3 conversion
      // You would need to sign up for such a service, examples include:
      // - Rapid API's YouTube to MP3 Converter
      // - YouTube Data API with a custom conversion process
      
      // This is a placeholder for a third-party API call
      // Replace with your actual API provider
      const apiResponse = await axios.get('https://your-audio-api.com/convert', {
        params: {
          url: videoUrl,
          api_key: process.env.AUDIO_API_KEY,
        }
      });
      
      const audioUrl = apiResponse.data.mp3_url;
      
      if (audioUrl) {
        return res.status(200).json({ message: 'Success using fallback method', mp3Url: audioUrl });
      } else {
        throw new Error('Fallback conversion failed');
      }
    } catch (fallbackError) {
      console.error('Fallback error:', fallbackError);
      
      // Option 3: Consider implementing a webhook approach with background processing
      // For this approach, you would:
      // 1. Send job to a queue or background worker
      // 2. Return a job ID to the client
      // 3. Process the conversion in a proper environment with necessary tools
      // 4. Notify the client when done (via webhook or client polling)
      
      return res.status(500).json({ 
        error: 'Conversion failed',
        message: 'Direct YouTube downloads are not supported in serverless environments. Consider using a background processing solution.',
        recommendation: 'Please implement a webhook-based approach or use a third-party API service.'
      });
    }
  }
};