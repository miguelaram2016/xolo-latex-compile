# Xolo LaTeX Compile Service Dockerfile
FROM texlive/texlive:latest

# Install Node.js
RUN apt-get update && apt-get install -y \
    nodejs \
    npm \
    && rm -rf /var/lib/apt/lists/*

# Create app directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy application
COPY . .

# Expose port
EXPOSE 3001

# Start the service
CMD ["node", "server.js"]
