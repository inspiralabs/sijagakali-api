# sijagakali-api — monorepo npm workspaces. Satu build, dua image akhir:
#   runtime    : api, mqtt-collector, data-processing
#   runtime-wa : runtime + Chromium, khusus notification-gateway (whatsapp-web.js)
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY api/package.json api/
COPY mqtt-collector/package.json mqtt-collector/
COPY data-processing/package.json data-processing/
COPY notification-gateway/package.json notification-gateway/
# Chromium dipasang dari apt di runtime-wa; jangan unduh versi puppeteer
ENV PUPPETEER_SKIP_DOWNLOAD=true
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
# /app milik node: whatsapp-web.js menulis ./.wwebjs_cache di working dir
RUN mkdir -p /app && chown node:node /app
WORKDIR /app
COPY --from=build --chown=node:node /app ./
USER node

FROM runtime AS runtime-wa
USER root
RUN apt-get update \
 && apt-get install -y --no-install-recommends chromium fonts-liberation \
 && rm -rf /var/lib/apt/lists/* \
 && mkdir -p /data/wa && chown node:node /data/wa
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
USER node
