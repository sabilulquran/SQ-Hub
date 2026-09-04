# syntax=docker/dockerfile:1

FROM node:22.23.2-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
RUN npm ci

COPY apps/api apps/api
RUN npm --workspace @sq-hub/api run build

FROM node:22.23.2-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/apps/api/dist apps/api/dist
COPY apps/api/migrations apps/api/migrations

USER node
EXPOSE 3100
CMD ["node", "apps/api/dist/server.js"]
