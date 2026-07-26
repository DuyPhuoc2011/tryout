# Build the web app (Next standalone output) from the monorepo root context.
FROM node:20-slim AS build
RUN corepack enable
WORKDIR /repo
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages ./packages
COPY apps/web ./apps/web
RUN pnpm install --frozen-lockfile
# NEXT_PUBLIC_* is inlined into the client bundle at build time, so it must be
# present here (not just at runtime). CI passes it as --build-arg.
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
RUN pnpm --filter @tryout/shared build && pnpm --filter @tryout/web build

FROM node:20-slim AS run
WORKDIR /app
COPY --from=build /repo/apps/web/.next/standalone ./
COPY --from=build /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /repo/apps/web/public ./apps/web/public
ENV PORT=8080
EXPOSE 8080
CMD ["node", "apps/web/server.js"]
