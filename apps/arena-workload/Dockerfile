# The scenario application under test. Built from the monorepo root context.
#
# Deliberately NOT the marketplace API: a buyer environment must never hold
# Stripe or GitHub credentials, and the marketplace has no background-job tier
# to split. This image is the workload the arena measures and nothing else.
FROM node:20-slim AS build
RUN corepack enable
WORKDIR /repo
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/arena-workload ./apps/arena-workload
RUN pnpm install --frozen-lockfile --filter @tryout/arena-workload...
RUN pnpm --filter @tryout/arena-workload build
RUN pnpm --filter @tryout/arena-workload --prod deploy /out

FROM node:20-slim AS run
WORKDIR /app
COPY --from=build /out ./
ENV PORT=8080
EXPOSE 8080
CMD ["node", "dist/main.js"]
