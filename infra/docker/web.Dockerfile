# Stage 9: one image per DealDash web app (customer, merchant, staff, partner, admin). Build with --build-arg APP=<app>.
# NEXT_PUBLIC_API_URL is public configuration (the API origin), set at build time per environment; no secret is ever baked in.
#   docker build -f infra/docker/web.Dockerfile --build-arg APP=customer --build-arg NEXT_PUBLIC_API_URL=https://api.example -t dealdash-customer:<v> .
# NEXT_PUBLIC_APP_ENV = the tier the image is built for (staging builds: noindex everywhere + the "STAGING" label; only a
# production build of the customer app may be indexed). Unset = treated as a non-production build (never indexed).
FROM node:22-alpine AS build
ARG APP
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_APP_ENV
ENV NEXT_TELEMETRY_DISABLED=1 NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL} NEXT_PUBLIC_APP_ENV=${NEXT_PUBLIC_APP_ENV}
WORKDIR /repo
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm build:packages
RUN pnpm --filter @dealdash/${APP} build

FROM node:22-alpine
ARG APP
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 APP=${APP}
WORKDIR /repo
RUN addgroup -S dealdash && adduser -S dealdash -G dealdash
COPY --from=build --chown=dealdash:dealdash /repo /repo
USER dealdash
EXPOSE 3000
CMD ["sh", "-c", "cd apps/${APP} && node_modules/.bin/next start -p 3000"]
