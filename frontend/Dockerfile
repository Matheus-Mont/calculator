# ---- build ----
FROM node:24-alpine AS build

WORKDIR /app

# Copy the manifests first so `npm ci` is cached until dependencies change.
COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json vite.config.ts index.html ./
COPY src ./src

# Type-check and test before building, so a broken frontend fails the image
# build rather than reaching a browser.
RUN npm run typecheck && npm run test
RUN npm run build

# ---- runtime ----
FROM nginx:1.29-alpine

COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

# curl is needed for the compose healthcheck.
RUN apk add --no-cache curl

HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -fsS http://localhost/ >/dev/null || exit 1
