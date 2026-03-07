FROM node:20-bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        bash \
        ca-certificates \
        g++ \
        make \
        psmisc \
        python3 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

RUN chmod +x /app/docker/entrypoint.sh /app/lavalink/jre/bin/java

ENV NODE_ENV=production \
    CONFIG_WEB_HOST=0.0.0.0 \
    CONFIG_WEB_PORT=3210 \
    AUDIO_CACHE_HOST=127.0.0.1 \
    AUDIO_CACHE_PORT=3211

EXPOSE 3210

CMD ["./docker/entrypoint.sh"]
