# apps/worker image (11.operations.md "Deploy targets"). Build from the repository root,
# because the worker imports workspace packages that Bun resolves through the root lockfile:
#
#   docker build -f apps/worker/Dockerfile -t marmitop-worker .
#   docker run --rm --env-file apps/worker/.env marmitop-worker
#
# Always on, at least one instance; several are safe (ADR-007). No build step.

FROM oven/bun:1.4.0-alpine AS deps
WORKDIR /app
COPY package.json bun.lock ./
COPY apps ./apps
COPY packages ./packages
RUN bun install --frozen-lockfile --production --ignore-scripts

FROM oven/bun:1.4.0-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production MT_ENV=production WORKER_HEALTH_PORT=8181
COPY --from=deps /app /app
# `bun` is the non-root user of the base image. The worker writes nothing to disk.
USER bun
EXPOSE 8181
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- "http://127.0.0.1:${WORKER_HEALTH_PORT}/health" || exit 1
CMD ["bun", "apps/worker/src/index.ts"]
