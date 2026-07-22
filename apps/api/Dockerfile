# Build the API from the monorepo root context.
FROM node:20-slim AS build
RUN corepack enable
WORKDIR /repo
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages ./packages
COPY apps/api ./apps/api
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @tryout/shared build \
  && pnpm --filter @tryout/db build \
  && pnpm --filter @tryout/llm build \
  && pnpm --filter @tryout/api build
RUN pnpm --filter @tryout/api --prod deploy /out

FROM node:20-slim AS run
WORKDIR /app
COPY --from=build /out ./
ENV PORT=8080
EXPOSE 8080
CMD ["node", "dist/main.js"]
