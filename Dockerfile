# Multi-stage Dockerfile for gridlock-scraper using official Playwright noble image
# Stage 1: Build stage
FROM mcr.microsoft.com/playwright:v1.63.0-noble AS builder

WORKDIR /app

# Copy dependency manifests
COPY package*.json ./

# Install dependencies and build
RUN npm ci

# Copy source files and configs
COPY tsconfig.json ./
COPY src/ ./src/

# Build TypeScript to dist/
RUN npm run build

# Stage 2: Runtime stage
FROM mcr.microsoft.com/playwright:v1.63.0-noble AS runner

WORKDIR /app
ENV NODE_ENV=production

# Install production dependencies
COPY package*.json ./
RUN npm ci --omit=dev

# Copy compiled application code
COPY --from=builder /app/dist ./dist

# Run as unprivileged Playwright user
USER pwuser

CMD ["node", "dist/server.js"]
