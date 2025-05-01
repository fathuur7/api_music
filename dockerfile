FROM node:18

WORKDIR /app

RUN apt-get update && apt-get install -y curl xz-utils && \
    curl -O https://johnvansickle.com/ffmpeg/builds/ffmpeg-git-amd64-static.tar.xz && \
    tar xf ffmpeg-git-*.tar.xz && \
    cp ffmpeg-git-*/ffmpeg ffmpeg-git-*/ffprobe /usr/local/bin/ && \
    rm -rf ffmpeg-git-*

COPY package.json .
RUN npm install

COPY . .

CMD ["node", "app.js"]
