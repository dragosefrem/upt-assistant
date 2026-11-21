#!/bin/sh
set -eu

if [ -z "${APP_URL:-}" ] && [ -n "${RAILWAY_PUBLIC_DOMAIN:-}" ]; then
    export APP_URL="https://${RAILWAY_PUBLIC_DOMAIN}"
fi

# Railway mounts the volume after the image is built. Set ownership on the mount itself.
if [ "$(id -u)" = 0 ]; then
    chown node:node /data
    exec gosu node "$@"
fi
exec "$@"
