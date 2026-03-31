# ---------------------------------------------------------
# Phase 1: Build dependencies (Native Module Compilation)
# ---------------------------------------------------------
FROM node:24-bookworm-slim AS builder
WORKDIR /app

# Install compilation tools for native modules (like better-sqlite3)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Copy only package files to install dependencies
COPY backend/package*.json ./backend/
WORKDIR /app/backend

# Install production dependencies (will compile native bindings for the target arch)
RUN npm install --omit=dev && npm cache clean --force


# ---------------------------------------------------------
# Phase 2: Ultimate Performance Lean Runner
# ---------------------------------------------------------
# This stage expects frontend/dist and backend/dist 
# to be pre-built outside the container via CI.
FROM node:24-bookworm-slim AS runner
WORKDIR /app

# Environment variables
ENV NODE_ENV=production
ENV PORT=3000

# Copy compiled native node_modules from builder phase
COPY --from=builder /app/backend/node_modules ./backend/node_modules

# Copy pre-built platform-independent artifacts from the host context
COPY frontend/dist ./frontend/dist
COPY backend/dist ./backend/dist
COPY backend/package*.json ./backend/
COPY backend/schema.sql ./

# Ensure correct ownership for non-root user
RUN chown -R node:node /app
USER node

# Expose mapping port
EXPOSE 3000

# Start command
CMD ["node", "backend/dist/server.js"]