-- 新增：私聊会话类型、拾语号（用户）、群号（群组）
-- 先加可空列 → 回填 → 再加 NOT NULL 与唯一索引，保证已有数据也能平滑升级

ALTER TABLE "User" ADD COLUMN "public_id" INTEGER;
UPDATE "User" u
SET "public_id" = 100000 + r.rn
FROM (SELECT "id", ROW_NUMBER() OVER (ORDER BY "created_at", "id") AS rn FROM "User") r
WHERE u."id" = r."id";
ALTER TABLE "User" ALTER COLUMN "public_id" SET NOT NULL;
CREATE UNIQUE INDEX "User_public_id_key" ON "User"("public_id");

ALTER TABLE "Group" ADD COLUMN "type" TEXT NOT NULL DEFAULT 'group';
ALTER TABLE "Group" ADD COLUMN "public_id" INTEGER;
UPDATE "Group" g
SET "public_id" = 500000 + r.rn
FROM (SELECT "id", ROW_NUMBER() OVER (ORDER BY "created_at", "id") AS rn FROM "Group") r
WHERE g."id" = r."id";
ALTER TABLE "Group" ALTER COLUMN "public_id" SET NOT NULL;
CREATE UNIQUE INDEX "Group_public_id_key" ON "Group"("public_id");
