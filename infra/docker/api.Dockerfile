# Stage 9: the DealDash API image (one NestJS modular monolith: HTTP API + background jobs). Provider-neutral; built by
# .github/workflows/release.yml. No secret is baked in: every setting comes from the environment at run time, and the process refuses
# to start with an unsafe production configuration (productionSafetyProblems).
# Build:  docker build -f infra/docker/api.Dockerfile -t dealdash-api:<version> .
FROM node:22-alpine AS build
WORKDIR /repo
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm build:packages
RUN pnpm --filter @dealdash/api db:generate
RUN pnpm --filter @dealdash/api build
# a self-contained production install of the API and its workspace packages
# (the generated Prisma client is TypeScript under src/generated and is compiled into dist with the rest of the API)
RUN pnpm --filter @dealdash/api deploy --prod /out && cp -r apps/api/dist /out/dist && cp -r apps/api/prisma /out/prisma && cp apps/api/prisma.config.ts /out/

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -S dealdash && adduser -S dealdash -G dealdash
COPY --from=build --chown=dealdash:dealdash /out /app
USER dealdash
EXPOSE 4000
# liveness: /v1/health/live ; readiness (load balancer): /v1/health/ready
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s CMD wget -qO- http://127.0.0.1:${API_PORT:-4000}/v1/health/live || exit 1
CMD ["node", "dist/main.js"]
