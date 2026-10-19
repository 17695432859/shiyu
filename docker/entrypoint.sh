#!/bin/sh
set -e

echo "[entrypoint] 执行数据库迁移…"
npx --no-install prisma migrate deploy --schema prisma/schema.prisma

if [ "${SEED}" = "true" ]; then
  echo "[entrypoint] SEED=true，写入演示数据（幂等）…"
  node dist/seed.js
fi

echo "[entrypoint] 启动服务，端口 ${PORT:-3000}"
exec node dist/index.js
