FROM node:24-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# better-sqlite3 can build from source when a matching native binary is unavailable.
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates g++ make python3 \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --include=dev --no-audit --no-fund
COPY . .
RUN npm run build && npm prune --omit=dev --no-audit --no-fund && rm -rf .next/cache

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    DATABASE_PATH=/data/upt.db \
    TIMETABLE_PYTHON=/opt/timetables/bin/python \
    CAMPUSPATH_PYTHON=/opt/campuspath/bin/python

RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates ffmpeg fonts-dejavu-core gosu python3-venv \
    && rm -rf /var/lib/apt/lists/*
COPY scripts/requirements-timetables.txt /tmp/timetables.txt
RUN python3 -m venv /opt/timetables \
    && /opt/timetables/bin/pip install --no-cache-dir -r /tmp/timetables.txt
COPY services/campuspath/requirements.txt /tmp/campuspath.txt
RUN python3 -m venv /opt/campuspath \
    && /opt/campuspath/bin/pip install --no-cache-dir -r /tmp/campuspath.txt

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY package.json next.config.ts tsconfig.json ./
COPY public ./public
COPY drizzle ./drizzle
COPY scripts ./scripts
COPY src ./src
COPY services/campuspath ./services/campuspath
RUN mkdir -p /data .next/cache .next/server/route-cache services/campuspath/.cache \
    && chown -R node:node /data .next/cache .next/server/route-cache services/campuspath/.cache

ENTRYPOINT ["/bin/sh", "/app/scripts/start-container.sh"]
CMD ["node", "node_modules/next/dist/bin/next", "start", "--hostname", "0.0.0.0"]
