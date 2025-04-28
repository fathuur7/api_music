FROM public.ecr.aws/lambda/nodejs:18

# Install FFmpeg
RUN yum update -y && \
    yum install -y xz && \
    curl -O https://johnvansickle.com/ffmpeg/builds/ffmpeg-git-amd64-static.tar.xz && \
    tar xf ffmpeg-git-amd64-static.tar.xz && \
    cp ffmpeg-git-*/ffmpeg ffmpeg-git-*/ffprobe /usr/local/bin/ && \
    rm -rf ffmpeg-git-*

# Copy your app
COPY app.js package.json ./
RUN npm install

CMD ["app.handler"]