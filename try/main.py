import yt_dlp
import cloudinary
import cloudinary.uploader
from dotenv import load_dotenv
import os

# Load .env file
load_dotenv()

# Setup Cloudinary
cloudinary.config(
    cloud_name=os.getenv('CLOUD_NAME'),
    api_key=os.getenv('API_KEY'),
    api_secret=os.getenv('API_SECRET')
)

def download_audio(url, output_filename='output.mp3'):
    ydl_opts = {
        'format': 'bestaudio/best',
        'outtmpl': output_filename,
        'postprocessors': [{
            'key': 'FFmpegExtractAudio',
            'preferredcodec': 'mp3',
            'preferredquality': '192',
        }],
    }
    
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        ydl.download([url])

    return output_filename

def upload_to_cloudinary(file_path):
    response = cloudinary.uploader.upload(file_path, resource_type="video")
    print("Uploaded to Cloudinary:", response['secure_url'])
    return response['secure_url']

if __name__ == "__main__":
    video_url = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
    try:
        print("Downloading audio...")
        file_path = download_audio(video_url)

        print("Uploading to Cloudinary...")
        uploaded_url = upload_to_cloudinary(file_path)

        # Optional: Delete the local file after upload
        if os.path.exists(file_path):
            os.remove(file_path)
            print("Local file deleted.")

        print("Process completed. File URL:", uploaded_url)
    except Exception as e:
        print("Something went wrong:", e)
