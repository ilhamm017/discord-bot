#!/usr/bin/env bash
set -euo pipefail

TARGET_DIR="${1:-/app/lavalink}"
LAVALINK_VERSION="${2:-4.2.1}"

mkdir -p "${TARGET_DIR}" "${TARGET_DIR}/logs"

curl -fsSL \
  "https://github.com/lavalink-devs/Lavalink/releases/download/${LAVALINK_VERSION}/Lavalink.jar" \
  -o "${TARGET_DIR}/Lavalink.jar"
