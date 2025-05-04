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
CMD ["node", "app.js"]