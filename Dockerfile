FROM node:20-alpine

WORKDIR /app

# Install dependencies for native modules and build tools
RUN apk add --no-cache python3 make g++ docker-cli

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy built application
COPY dist/ ./dist/

# Run as non-root user (after build)
# Note: User needs access to Docker socket, so we'll keep as root for now
# In production, consider using Docker socket proxy with proper permissions

EXPOSE 3005

CMD ["node", "dist/index.js"]
