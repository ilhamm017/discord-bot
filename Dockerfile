FROM node:20-bookworm-slim

ARG LAVALINK_VERSION=4.2.1

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        bash \
        ca-certificates \
        curl \
        g++ \
        make \
        openjdk-17-jre-headless \
        psmisc \
        python3 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

RUN chmod +x /app/docker/entrypoint.sh /app/docker/install-lavalink.sh \
    && /app/docker/install-lavalink.sh /app/lavalink "${LAVALINK_VERSION}" \
    && rm -rf /app/lavalink/jre /app/lavalink/plugins

ENV NODE_ENV=production \
    JAVA_BIN=java \
    CONFIG_WEB_HOST=0.0.0.0 \
    CONFIG_WEB_PORT=3210 \
    AUDIO_CACHE_HOST=127.0.0.1 \
    AUDIO_CACHE_PORT=3211

EXPOSE 3210

CMD ["./docker/entrypoint.sh"]
