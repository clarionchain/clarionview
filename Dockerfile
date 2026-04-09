FROM node:20-alpine AS base

FROM base AS deps
RUN apk add --no-cache libc6-compat python3 make g++
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NEXT_TELEMETRY_DISABLED 1
ARG NEXT_PUBLIC_BASE_PATH=
ENV NEXT_PUBLIC_BASE_PATH=$NEXT_PUBLIC_BASE_PATH
# Edge middleware inlines env at build time; must match runtime WORKBENCH_SESSION_SECRET or JWT verify fails (401).
ARG WORKBENCH_SESSION_SECRET=
ENV WORKBENCH_SESSION_SECRET=$WORKBENCH_SESSION_SECRET

RUN npm run build

FROM base AS runner
WORKDIR /app

ENV NODE_ENV production
ENV NEXT_TELEMETRY_DISABLED 1

RUN apk add --no-cache libc6-compat python3 make g++ su-exec
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

RUN mkdir -p ./public && chown nextjs:nodejs ./public
RUN mkdir -p .next && chown nextjs:nodejs .next
RUN mkdir -p /app/data && chown nextjs:nodejs /app/data

COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/better-sqlite3 ./node_modules/better-sqlite3
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/bcryptjs ./node_modules/bcryptjs
COPY --from=builder --chown=nextjs:nodejs /app/scripts ./scripts

# Rebuild native addon on this image’s musl so .node matches the runtime (avoids fcntl64 / dlopen issues).
RUN cd /app/node_modules/better-sqlite3 && npm run build-release \
  && chown -R nextjs:nodejs /app/node_modules/better-sqlite3
RUN apk del python3 make g++

COPY --chmod=755 docker-entrypoint.sh /docker-entrypoint.sh

# Run as root so entrypoint can fix /app/data ownership after volume mount,
# then drops to nextjs (uid 1001) via su-exec.
ENV SQLITE_PATH=/app/data/workbench.db

EXPOSE 3002

ENV PORT 3002
ENV HOSTNAME "0.0.0.0"

ENTRYPOINT ["/docker-entrypoint.sh"]
