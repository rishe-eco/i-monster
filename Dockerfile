# IMNSTR.com, one Node process, in two stages. The server runs through tsx with
# no build (PD-4): better-sqlite3 ships a prebuilt glibc binary for linux-x64
# (node_modules/better-sqlite3/prebuilds/), so nothing needs compiling. Only the
# admin bundle is built (PD-21), in a first stage that holds Vite and is then
# thrown away, so the image that runs carries no dev dependency and no toolchain.

# ── Stage 1: build the admin bundle ──
FROM node:24-slim AS build
WORKDIR /app

# --ignore-scripts: better-sqlite3's binding.gyp would make npm run node-gyp,
# which needs a toolchain this image does not have. Nothing here needs it.
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

COPY . .
RUN npm run build

# ── Stage 2: the server ──
FROM node:24-slim

ENV NODE_ENV=production
WORKDIR /app

# The prebuilt binary is loaded at run time, so skipping scripts loses nothing.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

COPY . .
# The bundle comes from stage 1, never from the host: .dockerignore leaves `dist` out.
# Boot refuses to start in production without it (lib/assets.ts).
COPY --from=build /app/dist/admin ./dist/admin

# The data and backup directories are bind mounts, owned by uid 1000 (`node`) on the host.
USER node
EXPOSE 4100

# slim has no curl, so the check is node's own fetch.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4100)+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"

CMD ["node", "--import", "tsx", "server.ts"]
