FROM node:18

# Create working directory
WORKDIR /app

# Copy dependency files first
COPY package.json ./
COPY package-lock.json ./

# Install dependencies with options to resolve conflicts
RUN npm install --legacy-peer-deps

# Copy all source code
COPY . .

# Run the app
CMD ["node", "app.js"]FROM node:20

# Install Python and other required dependencies
RUN apt-get update && \
    apt-get install -y python3 python3-pip && \
    ln -s /usr/bin/python3 /usr/bin/python && \
    apt-get install -y libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libgbm1 libasound2 libpangocairo-1.0-0 libxss1 libgtk-3-0 libxshmfence1 libglu1

# Create working directory
WORKDIR /app

# Copy dependency files first
COPY package.json ./
COPY package-lock.json ./

# Set environment variable to skip Python check if needed
# ENV YOUTUBE_DL_SKIP_PYTHON_CHECK=1

# Install dependencies
# Option 1: Use npm ci with proper Python environment
RUN npm ci

# Option 2: If npm ci still fails, try npm install with legacy peer deps
# RUN npm install --legacy-peer-deps

# Copy all source code
COPY . .

# Run the app
CMD ["node", "app.js"]