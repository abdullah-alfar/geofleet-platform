# syntax=docker/dockerfile:1
FROM node:22-alpine AS builder
WORKDIR /src

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# Production-only dependencies, installed separately so the runtime image
# never carries devDependencies (nest-cli, eslint, jest, ts-node, ...).
FROM node:22-alpine AS deps
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Same "prefer a distroless final image" pattern as the Go services (see
# docs/decisions/0005-geohash-and-dispatch-db-access.md) — no shell, no
# package manager, nothing beyond the Node runtime and this app's compiled
# output.
FROM gcr.io/distroless/nodejs22-debian12:nonroot
WORKDIR /app
COPY --from=deps /src/node_modules ./node_modules
COPY --from=builder /src/dist ./dist
COPY --from=builder /src/package.json ./package.json

USER nonroot
EXPOSE 3001

# gcr.io/distroless/nodejs* images already set ENTRYPOINT to their node
# binary — only the script argument is needed here.
CMD ["dist/main.js"]
