# ═══════════════════════════════════════════════════════════════════════════
# LAW MCP SERVER DOCKERFILE — UNIVERSAL TEMPLATE
# ═══════════════════════════════════════════════════════════════════════════
#
# Multi-stage Dockerfile for building and running a law MCP server.
# Works with any law MCP repo that follows the standard pattern:
#   src/index.ts (stdio entry), src/http-server.ts (HTTP entry),
#   data/database.db (pre-built SQLite DB).
#
# IMPORTANT: The database must be pre-built BEFORE running docker build.
# It is NOT built during the Docker build because the full DB includes
# ingested data that requires hours of network scraping.
#
# Build:
#   npm run build
#   docker build -t <repo-name> .
#
# Run (HTTP mode — standard for Hetzner/GHCR deployment):
#   docker run -p 3000:3000 -e LAW_DB_PATH=/app/data/database.db <repo-name>
#
# ═══════════════════════════════════════════════════════════════════════════

# ───────────────────────────────────────────────────────────────────────────
# STAGE 1: BUILD
# ───────────────────────────────────────────────────────────────────────────

FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci --ignore-scripts

COPY tsconfig.json ./
COPY src ./src

RUN npm run build

# ───────────────────────────────────────────────────────────────────────────
# STAGE 2: PRODUCTION
# ───────────────────────────────────────────────────────────────────────────

FROM node:20-alpine AS production

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

# Copy compiled JavaScript from builder stage
COPY --from=builder /app/dist ./dist

# Copy pre-built database
COPY data/database.db ./data/database.db

# Security: non-root user
RUN addgroup -S nodejs && adduser -S nodejs -G nodejs \
 && chown -R nodejs:nodejs /app/data
USER nodejs

# Environment
ENV NODE_ENV=production
ENV LAW_DB_PATH=/app/data/database.db
ENV PORT=3000

EXPOSE 3000

CMD ["node", "dist/http-server.js"]
