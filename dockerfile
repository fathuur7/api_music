FROM node:20-slim

# Install dependencies required for ffmpeg
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Create working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci || npm install

# Copy application code
COPY . .

# Install yt-dlp
RUN pip3 install yt-dlp && \
    ln -sf /usr/bin/python3 /usr/bin/python

# Create directories required by the app
RUN mkdir -p /tmp/youtube-downloads

# Expose the port your app runs on
EXPOSE 5000

# Set environment variables
ENV NODE_ENV=production
ENV PORT=5000

# Run the application
CMD ["node", "index.js"]