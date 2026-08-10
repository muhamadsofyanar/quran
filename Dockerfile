# syntax=docker/dockerfile:1.7

# @phase TQ-06 — production container with web, API, queue worker, and FFmpeg.

# =========================================================
# 1. DEPENDENCIES
# =========================================================
FROM node:22-bookworm-slim AS dependencies

WORKDIR /app

COPY package.json package-lock.json ./
COPY scripts ./scripts

# Pastikan semua shell script executable
RUN find scripts -type f -name "*.sh" -exec chmod +x {} \; \
    && npm ci


# =========================================================
# 2. BUILDER
# =========================================================
FROM node:22-bookworm-slim AS builder

WORKDIR /app

ENV NODE_ENV=production

COPY --from=dependencies /app/node_modules ./node_modules
COPY . .

# Fix exit code 126:
# semua script shell harus executable sebelum proses build
RUN find scripts -type f -name "*.sh" -exec chmod +x {} \; \
    && npm run build \
    && npm run validate:artifact


# =========================================================
# 3. PRODUCTION RUNNER
# =========================================================
FROM node:22-bookworm-slim AS runner

WORKDIR /app

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    TQ_DATA_DIR=/app/data

# FFmpeg diperlukan untuk proses media/rendering
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ffmpeg \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*


# =========================================================
# USER
# =========================================================
RUN groupadd --system --gid 1001 app \
    && useradd --system --uid 1001 --gid app app

RUN mkdir -p /app/.wrangler /app/data \
    && chown -R app:app /app/.wrangler /app/data


# =========================================================
# COPY PRODUCTION FILES
# =========================================================
COPY --from=builder --chown=app:app /app/package.json ./package.json
COPY --from=builder --chown=app:app /app/package-lock.json ./package-lock.json
COPY --from=builder --chown=app:app /app/node_modules ./node_modules

COPY --from=builder --chown=app:app /app/dist ./dist
COPY --from=builder --chown=app:app /app/vite.config.ts ./vite.config.ts
COPY --from=builder --chown=app:app /app/next.config.ts ./next.config.ts
COPY --from=builder --chown=app:app /app/build ./build
COPY --from=builder --chown=app:app /app/public ./public
COPY --from=builder --chown=app:app /app/worker ./worker
COPY --from=builder --chown=app:app /app/server ./server
COPY --from=builder --chown=app:app /app/lib ./lib
COPY --from=builder --chown=app:app /app/scripts ./scripts

# Pastikan shell scripts tetap executable di production image
RUN find /app/scripts -type f -name "*.sh" -exec chmod +x {} \; \
    && chown -R app:app /app/scripts


# =========================================================
# RUN AS NON-ROOT
# =========================================================
USER app

VOLUME ["/app/data"]

EXPOSE 3000


# =========================================================
# HEALTHCHECK
# =========================================================
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:3000/media-api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"


# =========================================================
# START APPLICATION
# =========================================================
CMD ["npm", "run", "start"]
