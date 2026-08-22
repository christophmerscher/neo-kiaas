# syntax=docker/dockerfile:1.6
# ----------------------------------------------------------------------------
# neo-KIAS production image
#
# Drei Stufen:
#   1. web-build   : install web/ deps, run "vite build" → web/dist
#   2. admin-build : dasselbe für die Vue-Verwaltung → admin/dist
#   3. runtime     : install only server prod deps, copy server code + dist
#
# Ein Image für alle Rollen. Beide Bündel zusammen sind wenige hundert
# Kilobyte; ein eigenes Image je Oberfläche wäre mehr Bau und mehr Pflege
# als es an Platz spart.
# ----------------------------------------------------------------------------

# ---- Stage 1: build the React/Vite frontend --------------------------------
FROM node:20-alpine AS web-build
WORKDIR /app/web

# Install web deps with locked versions for reproducible builds.
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund

# Copy sources and produce the production bundle.
COPY web/ ./
RUN npm run build

# ---- Stage 2: build the Vue admin UI ---------------------------------------
FROM node:20-alpine AS admin-build
WORKDIR /app/admin

COPY admin/package.json admin/package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY admin/ ./
RUN npm run build

# ---- Stage 3: lean production runtime --------------------------------------
FROM node:20-alpine AS runtime
WORKDIR /app

# Drop privileges: run as the built-in "node" user, never as root.
ENV NODE_ENV=production

# Install only the server's runtime deps.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund \
    # swagger-ui-dist ships source maps and alternative bundles that the
    # docs page never requests; dropping them saves ~15 MB in the image.
    && rm -f node_modules/swagger-ui-dist/*.map \
             node_modules/swagger-ui-dist/swagger-ui-es-bundle*.js \
             node_modules/swagger-ui-dist/swagger-ui.js \
    && npm cache clean --force

# Copy server code and the pre-built UI bundles from the stages above.
COPY server.js ./
COPY lib/ ./lib/
COPY --from=web-build /app/web/dist ./web/dist
COPY --from=admin-build /app/admin/dist ./admin/dist

# Pre-create the log directory with the right ownership so the unprivileged
# user can write to it. If the host mounts a volume here, ownership comes
# from the host — see README.md for the chown step.
RUN mkdir -p /logs && chown -R node:node /logs

# Where the DBF data, logs, and optional car-photo assets are expected —
# overridden by docker-compose volume mounts.
ENV KIAS_ROOT=/data \
    KIAS_CAR_IMAGES_DIR=/car-images \
    KIAS_SHOW_CAR_IMAGES=false \
    LOG_DIR=/logs \
    LOG_LEVEL=info \
    LOG_MAX_SIZE=10m \
    LOG_MAX_FILES=14 \
    LOG_FREQUENCY=daily \
    PORT=5175 \
    HOST=0.0.0.0

EXPOSE 5175
VOLUME ["/logs"]

# Drop to the unprivileged "node" user that the base image already provides.
USER node

# /api/health antwortet mit 200 nur dann, wenn die Daten geladen sind, und
# sonst mit 503. Das erspart das Durchsuchen einer Antwort nach Textstellen.
HEALTHCHECK --interval=30s --timeout=5s --start-period=120s --retries=3 \
  CMD wget -q -O /dev/null "http://127.0.0.1:${PORT}/api/health" || exit 1

CMD ["node", "server.js"]
