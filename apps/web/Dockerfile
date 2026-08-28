# syntax=docker/dockerfile:1

FROM node:22-alpine AS build
WORKDIR /app

COPY package.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm install

COPY apps/web apps/web
ARG VITE_SQ_HUB_PREVIEW=0
ENV VITE_SQ_HUB_PREVIEW=${VITE_SQ_HUB_PREVIEW}
RUN npm --workspace @sq-hub/web run build

FROM nginx:1.27-alpine AS runtime
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html

EXPOSE 80
