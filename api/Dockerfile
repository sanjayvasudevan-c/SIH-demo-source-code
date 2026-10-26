FROM node:20-alpine AS build
RUN apk add --no-cache openssl
WORKDIR /app
COPY package.json package-lock.json ./
COPY api/package.json api/package.json
COPY web/package.json web/package.json
RUN npm ci --workspace api --include-workspace-root=false
COPY shared shared
COPY api api
WORKDIR /app/api
RUN npx prisma generate && npm run build

FROM node:20-alpine
RUN apk add --no-cache openssl
WORKDIR /app
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/shared shared
COPY --from=build /app/api/package.json api/package.json
COPY --from=build /app/api/prisma api/prisma
COPY --from=build /app/api/dist api/dist
WORKDIR /app/api
RUN mkdir -p storage
ENV NODE_ENV=production
EXPOSE 4000
CMD ["node", "dist/src/index.js"]
