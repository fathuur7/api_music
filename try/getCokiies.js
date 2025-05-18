import ytdl from 'youtube-dl-exec';

// Ganti dengan video ID YouTube yang sesuai
const videoUrl = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'; // Ganti dengan URL video YouTube yang kamu inginkan

async function downloadVideo() {
  try {
    // Unduh video
    const { stdout, stderr } = await ytdl(videoUrl, {
      output: 'video.mp4'
    });
    
    console.log(stdout);
    if (stderr) {
      console.error(stderr);
    }
  } catch (error) {
    console.error('Error downloading video:', error);
  }
}

downloadVideo();
