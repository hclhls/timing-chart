FROM node:22-alpine AS web-build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN BASE_PATH=/ npm run build

FROM nginxinc/nginx-unprivileged:alpine AS web

COPY --from=web-build /app/dist /usr/share/nginx/html
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 8080

FROM node:22-alpine AS api

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --chown=node:node api ./api
USER node
EXPOSE 51124
CMD ["node", "api/server.mjs"]
