FROM node:18

# Buat folder kerja
WORKDIR /app

# Salin dependency terlebih dahulu
COPY package.json ./
COPY package-lock.json ./

# Install dengan toleransi konflik
RUN npm install --legacy-peer-deps

# Salin semua source code
COPY . .

# Jalankan app
CMD ["node", "app.js"]
