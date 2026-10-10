# OpenWriter in hosted mode: one writer's private copy, run as a Fly.io Machine
# behind the sign-in gateway. Data lives on the volume mounted at /data.
# adr: adr/hosted-gateway-trust.md

FROM node:22-bookworm-slim AS build
WORKDIR /app

# Install from the lockfile first so source edits keep the dependency layer cached.
COPY package.json package-lock.json ./
COPY packages/openwriter/package.json packages/openwriter/
COPY plugins/authors-voice/package.json plugins/authors-voice/
COPY plugins/github/package.json plugins/github/
COPY plugins/image-gen/package.json plugins/image-gen/
COPY plugins/publish/package.json plugins/publish/
COPY plugins/x-api/package.json plugins/x-api/
RUN npm ci

COPY . .
RUN npm run build --workspace openwriter && npm prune --omit=dev

FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    OW_HOSTED=1 \
    OW_DATA_DIR=/data \
    PORT=8080
WORKDIR /app
COPY --from=build --chown=node:node /app /app
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 8080
# OW_GATEWAY_SECRET and OW_PUBLIC_URL come from Fly secrets/env; the server
# refuses to start without them.
CMD ["node", "packages/openwriter/dist/bin/pad.js"]
