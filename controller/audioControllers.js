// controller/audioControllers.js
import { video_info, stream } from 'play-dl';
import { v2 as cloudinary } from 'cloudinary';
import axios from 'axios';
import ytdl from 'ytdl-core';

// Cloudinary configuration
cloudinary.config({
  cloud_name: process.env.CLOUD_NAME,
  api_key: process.env.API_KEY,
  api_secret: process.env.API_SECRET
});

// Function to stream directly to Cloudinary
const streamToCloudinary = async (audioStream, format, title) => {
  return new Promise((resolve, reject) => {
    // Create writable stream for Cloudinary
    const cloudinaryStream = cloudinary.uploader.upload_stream(
      {
        resource_type: 'video',
        format: format,
        public_id: `audio_${Date.now()}_${title.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 30)}`
      },
      (error, result) => {
        if (error) {
          return reject(error);
        }
        resolve(result);
      }
    );

    // Pipe directly from YouTube to Cloudinary (without saving to disk)
    audioStream.pipe(cloudinaryStream);
  });
};

// Alternative method using YouTube Data API for getting video info
const getVideoInfoFromAPI = async (videoId) => {
  try {
    const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY || 'AIzaSyAzu95CN-s2h-Af_YiYzVavs7j32b_rNiA';
    const response = await axios.get(`https://www.googleapis.com/youtube/v3/videos`, {
      params: {
        part: 'snippet,contentDetails',
        id: videoId,
        key: YOUTUBE_API_KEY
      }
    });
    
    if (response.data.items && response.data.items.length > 0) {
      const video = response.data.items[0];
      return {
        title: video.snippet.title,
        duration: video.contentDetails.duration, // ISO 8601 duration format
        thumbnailUrl: video.snippet.thumbnails.high?.url || video.snippet.thumbnails.medium?.url || video.snippet.thumbnails.default?.url
      };
    }
    return null;
  } catch (error) {
    console.error('Error fetching video info from API:', error);
    throw error;
  }
};

// Extract video ID from YouTube URL
const extractVideoId = (url) => {
  const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
  const match = url.match(regExp);
  return match && match[2].length === 11 ? match[2] : null;
};

// Controller for converting YouTube video to audio using play-dl
export const convertVideoToAudio = async (req, res) => {
  const { url } = req.body;
  
  if (!url) {
    return res.status(400).json({ error: 'Invalid URL' });
  }

  try {
    // Extract video ID
    const videoId = extractVideoId(url);
    if (!videoId) {
      return res.status(400).json({ error: 'Could not extract video ID from URL' });
    }

    // Get video info from YouTube API
    const videoInfo = await getVideoInfoFromAPI(videoId);
    if (!videoInfo) {
      return res.status(400).json({ error: 'Could not retrieve video information' });
    }
    
    // Get audio stream using play-dl
    let audioStream;
    try {
      audioStream = await stream(url, { 
        quality: 140, // m4a 128 kbps audio format
        discordPlayerCompatibility: false
      });
      
      if (!audioStream) {
        throw new Error('Could not create audio stream');
      }
      
      // Upload directly to Cloudinary
      const result = await streamToCloudinary(audioStream.stream, 'mp3', videoInfo.title);
      
      // Return success response with audio details
      return res.status(200).json({
        success: true,
        title: videoInfo.title,
        url: result.secure_url,
        filename: result.public_id,
        duration: videoInfo.duration,
        thumbnail: videoInfo.thumbnailUrl
      });
    } catch (playDlError) {
      console.log('play-dl streaming failed, falling back to ytdl-core', playDlError.message);
      
      // Fallback to ytdl-core if play-dl fails
      return useYtdlFallback(res, url, videoId, videoInfo);
    }
    
  } catch (error) {
    console.error('Error:', error);
    return res.status(500).json({
      error: 'An error occurred while processing the video',
      message: error.message
    });
  }
};

// Fallback method using ytdl-core
const useYtdlFallback = async (res, url, videoId, videoInfo) => {
  try {
    // Get audio stream using ytdl-core
    const ytdlStream = ytdl(url, { 
      quality: 'highestaudio',
      filter: 'audioonly'
    });
    
    // Handle any errors with the stream
    ytdlStream.on('error', (err) => {
      console.error('ytdl stream error:', err);
      return res.status(500).json({
        error: 'Failed to create audio stream with fallback method',
        message: err.message
      });
    });
    
    // Upload to Cloudinary
    const result = await streamToCloudinary(ytdlStream, 'mp3', videoInfo.title);
    
    // Return success response
    return res.status(200).json({
      success: true,
      title: videoInfo.title,
      url: result.secure_url,
      filename: result.public_id,
      duration: videoInfo.duration,
      thumbnail: videoInfo.thumbnailUrl,
      method: 'ytdl-fallback'
    });
  } catch (error) {
    console.error('ytdl fallback error:', error);
    return res.status(500).json({
      error: 'Fallback method failed',
      message: error.message
    });
  }
};

// Add a healthcheck route to verify API key
export const youtubeApiHealthCheck = async (req, res) => {
  try {
    const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY || 'AIzaSyAzu95CN-s2h-Af_YiYzVavs7j32b_rNiA';
    const response = await axios.get('https://www.googleapis.com/youtube/v3/videos', {
      params: {
        part: 'snippet',
        chart: 'mostPopular',
        maxResults: 1,
        key: YOUTUBE_API_KEY
      }
    });
    
    return res.json({
      status: 'success',
      message: 'YouTube API connection successful',
      data: {
        apiKeyWorking: true,
        videoCount: response.data.items.length
      }
    });
  } catch (error) {
    return res.status(500).json({
      status: 'error',
      message: 'YouTube API connection failed',
      error: error.response?.data || error.message
    });
  }
};