# Build only the audited context emitted by scripts/prepare-hosted.cjs.
FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates openssl chromium fonts-liberation \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm ci --include=dev \
    && npm run build:shared \
    && npm run build -w recruiter-backend \
    && API_URL=http://127.0.0.1:3333 npm run build -w recruiter-frontend \
    && mkdir -p /data && chown node:node /data \
    && chown -R node:node /app/recruiter-frontend/.next
ENV NODE_ENV=production API_HOST=127.0.0.1 PORT=3333 \
    API_URL=http://127.0.0.1:3333 XDG_DATA_HOME=/data \
    JOBTRACKER_WEB_CONFIG=/data/job-tracker/web-access.json \
    DISCOVERY_BROWSER_HEADLESS=true DISCOVERY_BROWSER_EXECUTABLE=/usr/bin/chromium
USER node
EXPOSE 3000
CMD ["node", "deploy/start-hosted.cjs"]
