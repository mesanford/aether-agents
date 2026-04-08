FROM node:20-alpine

# Set working directory
WORKDIR /app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies strictly for production
RUN npm ci

# Copy full application code
COPY . .

# Build the frontend (Vite)
RUN npm run build

# Expose port (Cloud Run defaults to 8080)
EXPOSE 8080

# Environment setup
ENV NODE_ENV=production
ENV PORT=8080

# Start server using ts-node or compiled dist (assuming tsx runs server.ts)
CMD ["npx", "tsx", "server.ts"]
