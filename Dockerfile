# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM dependencies AS source
COPY . .
ARG RELEASE_SHA
ARG BUILD_PROFILE=ci
ENV NEXT_TELEMETRY_DISABLED=1 RELEASE_BUILD=true APP_RELEASE_SHA=$RELEASE_SHA BUILD_PROFILE=$BUILD_PROFILE

FROM source AS public-build
RUN node scripts/prepare-map-assets.mjs
RUN --mount=type=secret,id=public_supabase_url --mount=type=secret,id=public_supabase_anon_key \
  node scripts/release/build-container.mjs public

FROM source AS admin-build
RUN --mount=type=secret,id=public_supabase_url --mount=type=secret,id=public_supabase_anon_key \
  node scripts/release/build-container.mjs admin

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=45s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health',{signal:AbortSignal.timeout(4000)}).then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

FROM runtime AS public
COPY --from=public-build --chown=node:node /app/.next/standalone ./
COPY --from=public-build --chown=node:node /app/.next/static ./.next/static
COPY --from=public-build --chown=node:node /app/public ./public
CMD ["node", "server.js"]

FROM runtime AS admin
COPY --from=admin-build --chown=node:node /app/apps/admin/.next/standalone ./
COPY --from=admin-build --chown=node:node /app/apps/admin/.next/static ./apps/admin/.next/static
CMD ["node", "apps/admin/server.js"]
