# IMNSTR.com, one Node process. No build stage: better-sqlite3 ships a prebuilt
# glibc binary for linux-x64 (node_modules/better-sqlite3/prebuilds/), so
# nothing needs compiling, and the server runs through tsx (PD-4).
FROM node:24-slim

ENV NODE_ENV=production
WORKDIR /app

# --ignore-scripts: better-sqlite3's binding.gyp would make npm run node-gyp,
# which needs a toolchain this image does not have. The prebuilt binary is
# loaded at run time, so skipping scripts loses nothing.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

COPY . .

# The data and backup directories are bind mounts, owned by uid 1000 (`node`) on the host.
USER node
EXPOSE 4100

# slim has no curl, so the check is node's own fetch.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4100)+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"

CMD ["node", "--import", "tsx", "server.ts"]
