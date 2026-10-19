# ---------- 构建阶段：装全量依赖 + 编译前后端 ----------
FROM node:22-alpine AS build
WORKDIR /app

# Prisma 在 alpine 上需要 openssl
RUN apk add --no-cache openssl libc6-compat

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY prisma ./prisma
RUN npx prisma generate --schema prisma/schema.prisma

COPY tsconfig.server.json tsconfig.web.json vite.config.ts ./
COPY server ./server
COPY web ./web

RUN npm run build


# ---------- 运行阶段：只保留产物与生产依赖 ----------
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000

RUN apk add --no-cache openssl libc6-compat \
    && addgroup -S app \
    && adduser -S app -G app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

# 使用构建阶段生成的 Prisma Client（含 musl 引擎），避免运行时再编译
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/node_modules/@prisma/client ./node_modules/@prisma/client

COPY prisma ./prisma
COPY --from=build /app/dist ./dist
COPY --from=build /app/web/dist ./web/dist
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh

RUN chmod +x /usr/local/bin/entrypoint.sh \
    && mkdir -p /app/data/uploads \
    && chown -R app:app /app

USER app
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/api/health" > /dev/null 2>&1 || exit 1

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
