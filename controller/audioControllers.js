import axios from 'axios';

export const convertVideoToAudio = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { videoUrl } = req.body;
  if (!videoUrl) {
    return res.status(400).json({ error: 'Video URL is required' });
  }

  try {
    // Extract video ID from YouTube URL
    const videoId = extractYoutubeId(videoUrl);
    if (!videoId) {
      return res.status(400).json({ error: 'Invalid YouTube URL' });
    }

    // Use free y-api.org service (public API, no key needed)
    // This is a free service, but has limitations on usage
    const audioUrl = `https://www.y-api.org/api/v1/audio/${videoId}`;
    
    // Verify the audio URL works by making a HEAD request
    try {
      await axios.head(audioUrl);
      return res.status(200).json({ 
        message: 'Success', 
        mp3Url: audioUrl,
        note: 'This is using a free public API with usage limits. For production use, consider a paid service.'
      });
    } catch (verifyError) {
      console.error('Audio URL verification failed:', verifyError);
      throw new Error('Audio conversion service unavailable');
    }
  } catch (err) {
    console.error('Conversion error:', err);
    
    // Return a helpful error with alternatives
    return res.status(500).json({ 
      error: 'Conversion failed',
      message: 'The free conversion service is unavailable or rate-limited.',
      alternatives: [
        // These are free alternatives the user can implement
        'Use ytdl-core with a non-serverless environment (VPS or dedicated server)',
        "Use YouTube's iframe API to play audio only (client-side solution)",
        'Try a different free API service (search for "YouTube to MP3 API free")'
      ]
    });
  }
};

// Helper function to extract YouTube video ID
function extractYoutubeId(url) {
  if (!url) return null;
  
  // Handle various YouTube URL formats
  const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
  const match = url.match(regExp);
  
  return (match && match[2].length === 11) ? match[2] : null;
}