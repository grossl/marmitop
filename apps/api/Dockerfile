# apps/api image (11.operations.md "Deploy targets"). Build from the repository root,
# because the api imports workspace packages that Bun resolves through the root lockfile:
#
#   docker build -f apps/api/Dockerfile -t marmitop-api .
#   docker run --rm -p 3101:3101 --env-file apps/api/.env marmitop-api
#
# No build step: Bun runs the TypeScript sources. The image also carries
# supabase/migrations, so the host's release command can run the migration runner:
#
#   bun run --cwd packages/db migrate     # needs MIGRATION_DATABASE_URL (owner URL)

FROM oven/bun:1.4.0-alpine AS deps
WORKDIR /app
COPY package.json bun.lock ./
COPY apps ./apps
COPY packages ./packages
RUN bun install --frozen-lockfile --production --ignore-scripts

FROM oven/bun:1.4.0-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production MT_ENV=production PORT=3101
COPY --from=deps /app /app
COPY supabase/migrations ./supabase/migrations
# `bun` is the non-root user of the base image. The api writes nothing to disk.
USER bun
EXPOSE 3101
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- "http://127.0.0.1:${PORT}/v1/health" || exit 1
CMD ["bun", "apps/api/src/index.ts"]
