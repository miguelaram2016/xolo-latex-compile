# Xolo LaTeX Compile Service Dockerfile
FROM texlive/texlive:latest

# Install Node.js
RUN apt-get update && apt-get install -y \
    nodejs \
    npm \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system latex && useradd --system --gid latex --create-home latex

# Create app directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install --omit=dev

# Copy application
COPY . .

RUN chown -R latex:latex /app
USER latex
ENV HOME=/home/latex

# Expose port
EXPOSE 3001

# Start the service
CMD ["node", "server.js"]
