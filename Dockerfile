FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install ALL dependencies (including devDeps needed for build/tsx)
RUN npm ci

# Copy full application code
COPY . .

# Build the frontend (Vite)
RUN npm run build

# ---- Production stage ----
FROM node:20-alpine AS runner

WORKDIR /app

# Copy package files and install production deps only
COPY package*.json ./
RUN npm ci --omit=dev

# Install tsx explicitly for production server execution
RUN npm install tsx

# Copy built frontend and source from builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/src ./src
COPY --from=builder /app/server.ts ./server.ts
COPY --from=builder /app/tsconfig.json ./tsconfig.json

# Expose port
EXPOSE 8080

# Set environment
ENV NODE_ENV=production
ENV PORT=8080

# Use tsx directly (not via npx to avoid download latency)
CMD ["node_modules/.bin/tsx", "server.ts"]
