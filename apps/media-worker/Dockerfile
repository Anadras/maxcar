# Multi-stage build: compile TypeScript in a full Node image, run in a
# slim Debian image with ffmpeg installed from apt (not a from-source
# build — the pilot's volume doesn't need bleeding-edge codec support,
# and Debian's ffmpeg build already carries libx264/libfdk free-aac
# equivalents sufficient for this worker's h264+aac target).

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json tsconfig.json ./
RUN npm install
COPY src ./src
RUN npm run build

FROM node:22-bookworm-slim AS runtime
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Never run as root inside the container.
RUN useradd --create-home --shell /usr/sbin/nologin worker
WORKDIR /app
ENV NODE_ENV=production
COPY package.json ./
RUN npm install --omit=dev
COPY --from=build /app/dist ./dist
USER worker

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.MEDIA_WORKER_HEALTH_PORT||8080)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/index.js"]
