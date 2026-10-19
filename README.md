# 拾语

一个可以真正拿来用的群组聊天应用：真实后端、真实数据库、真实鉴权、一键容器化部署。
名字取自「拾起每一句话」，界面走中性灰阶 + 单一强调色，浅色 / 深色双主题。

支持群聊与**一对一私聊**；每个用户有唯一的**拾语号**（100001 起），每个群/会话有唯一的**群号**（500001 起），都能被搜索。

---

## 技术栈

| 层 | 选型 | 说明 |
| --- | --- | --- |
| 前端 | Vite + React 18 + TypeScript | 单页应用，构建后由后端直接托管 |
| 状态 | zustand | 聊天状态、未读、连接状态集中管理 |
| 长列表 | @tanstack/react-virtual | 消息列表虚拟滚动，支持动态高度 |
| 图标 | lucide-react | 全站统一线性图标，无 emoji 功能图标 |
| 后端 | Fastify 5 | REST + WebSocket 同一进程同一端口 |
| ORM | Prisma 6 | 参数化查询，迁移可版本化 |
| 数据库 | PostgreSQL 16（生产）/ SQLite（本地兜底） | compose 中用 Postgres，数据落 named volume |
| 鉴权 | 服务端会话（DB 存储）+ CSRF 双提交 | bcrypt(cost 12) 哈希，会话令牌只存 HMAC |
| 实时 | @fastify/websocket | 断线自动重连 + 断线补拉 |

> 关于「JWT_SECRET」：本项目没有采用 JWT，而是**服务端会话**（DB 里存 token 的 HMAC，Cookie 里放原始 token），
> 因此对应的必填密钥是 `SESSION_SECRET`。作用与要求一致：**缺失或使用示例值会立即退出并报错**。
> 选择会话而非 JWT 的原因：登出 / 改密 / 踢人时需要「立即失效」，无状态 JWT 做不到，除非再加黑名单。

---

## 目录结构

```
shiyu/
├─ server/                 后端（TypeScript，编译到 dist/）
│  ├─ index.ts             启动、错误处理、静态资源、健康检查
│  ├─ env.ts               环境变量校验（缺失即退出）
│  ├─ db.ts                Prisma 客户端
│  ├─ http.ts              统一错误、鉴权守卫、IP 限流、CSRF
│  ├─ password.ts          bcrypt + zxcvbn 密码策略
│  ├─ sessions.ts          会话签发 / 滚动续期 / 失效
│  ├─ ws.ts                WebSocket 连接管理与广播
│  ├─ audit.ts             审计日志
│  ├─ lib/                 权限判定、DTO 序列化
│  ├─ routes/              auth / groups / members / messages / announcements / uploads
│  └─ seed.ts              演示数据脚本
├─ web/                    前端（Vite root）
│  ├─ index.html           主题预置脚本（防闪白）
│  └─ src/
│     ├─ styles.css        设计令牌 + 全部组件样式
│     ├─ store.ts          应用状态与实时事件处理
│     ├─ lib/              api / ws / 时间格式化 / markdown / 头像
│     ├─ components/       Sidebar、ChatPanel、MessageList、Composer、RightPanel、dialogs、ui
│     └─ screens/          AuthScreen、ChatScreen
├─ prisma/
│  ├─ schema.prisma        数据模型（Postgres）
│  ├─ schema.sqlite.prisma 由脚本生成，用于本地开发
│  └─ migrations/          Postgres 初始迁移
├─ docker/entrypoint.sh    迁移 → 可选 seed → 启动
├─ Dockerfile              多阶段构建，非 root 运行
├─ docker-compose.yml      app + db + named volume
└─ scripts/                schema 同步、接口自检（verify.mjs）、界面截图（flows.mjs）
```

---

## 快速开始（Docker，推荐）

```bash
cd shiyu

# 1. 准备环境变量
cp .env.example .env
# 生成密钥并填进 .env 的 SESSION_SECRET（必须，否则启动直接失败）
openssl rand -hex 32
# 同时把 POSTGRES_PASSWORD 改成你自己的密码

# 2. 启动全栈（首次自动构建镜像 + 执行数据库迁移）
docker compose up -d

# 3. 等健康检查通过
docker compose ps          # app 显示 (healthy) 即可
```

打开 <http://localhost:3000> 即可注册 / 登录。**默认是空库，没有任何预置账号**，第一个注册的人自己建群、加人即可。

想要一份现成的演示数据（1 个群主、2 个管理员、8 个成员、22 条中文消息、2 个私聊会话、1 条待审批申请）：

```bash
docker compose exec app node dist/seed.js   # 或把 .env 里 SEED 设为 true 后重启
```

种子脚本是幂等的，重复执行不会重复插入；执行后可用 `chenyan / Shiyu@2026Demo` 登录。

常用命令：

```bash
docker compose logs -f app      # 看日志（只输出到 stdout/stderr）
docker compose exec app id      # 验证非 root：uid=100(app)
docker compose down             # 停止，数据保留在 named volume
docker compose up -d            # 再启动，账号/群/公告/历史消息都还在
```

想清空数据重来：`docker compose down -v`（会删除 volume）。

---

## 本地开发（没有 Docker 也能跑）

本地没有 Postgres 时用 SQLite 兜底（模型完全一致，只是 provider 不同，由 `npm run db:sync` 从同一份 schema 生成）：

```bash
npm ci
cp .env.dev.example .env      # DATABASE_URL=file:../data/dev.db
npm run db:dev                # 建表 + 生成 SQLite 版 Prisma Client
npm run seed                  # 写入演示数据
npm run dev                   # 同时起后端 3000 与前端 5173
```

访问 <http://localhost:5173>（Vite 已把 `/api` 与 `/ws` 代理到 3000）。
生产构建本地预览：`npm run build && npm start`，访问 <http://localhost:3000>。

> 本地开发切回 Postgres：把 `.env` 的 `DATABASE_URL` 改成 `postgresql://...`，
> 然后 `npm run db:pg:generate && npm run db:pg:migrate`。

---

## 账号与号码

默认空库，**没有测试账号**。注册时系统会自动分配：

- **拾语号**（用户）：从 `100001` 起递增，唯一，可在「发起私聊」里按号搜人；
- **群号**（群组/私聊）：从 `500001` 起递增，唯一，可在「发现群组」里按号搜群。

演示数据里密码统一为 **`Shiyu@2026Demo`**（执行 `npm run seed` 后才有）。密码策略很宽松，只要 ≥8 位，`12345678` 也能注册。

| 用户名 | 昵称 | 角色 | 用途 |
| --- | --- | --- | --- |
| `chenyan` | 陈砚 | 群主 | 任命管理员、踢人、转让、解散 |
| `linzhiyuan` | 林知远 | 管理员 | 审批入群、禁言、删消息、改公告 |
| `suwan` | 苏晚 | 管理员 | 同上 |
| `zhoumu` | 周牧 | 成员 | 验证成员越权返回 403 |
| `heyinuo` / `xuqinghe` / `gubei` / `shenyiran` / `jiangjinyue` / `luoqinghe` / `wenyan` | 何一诺 等 | 成员 | 凑满 8 名成员 |
| `bailu` | 白露 | 非成员 | 种子数据里带一条**待审批**入群申请 |

用 `bailu` 登录 → 发现群组里能看到申请状态；用 `chenyan` 登录 → 右上「入群申请」通过后，`bailu` 立即出现在成员列表。

---

## 环境变量

| 变量 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- |
| `DATABASE_URL` | ✅ | — | `postgresql://user:pass@host:5432/db?schema=public`，本地可用 `file:../data/dev.db` |
| `SESSION_SECRET` | ✅ | — | 会话令牌 HMAC 密钥，≥32 字符；缺失 / 过短 / 使用示例值都会启动失败 |
| `POSTGRES_PASSWORD` | ✅(compose) | — | Postgres 密码，compose 用它拼 `DATABASE_URL` |
| `POSTGRES_USER` | | `shiyu` | 数据库用户 |
| `POSTGRES_DB` | | `shiyu` | 数据库名 |
| `APP_PORT` | | `3000` | 宿主机映射端口（compose 用） |
| `NODE_ENV` | | `production` | 生产镜像中固定为 production |
| `PORT` | | `3000` | 容器内监听端口 |
| `SEED` | | `false` | `true` 时启动写入演示数据（幂等） |
| `COOKIE_SECURE` | | `auto` | `auto` 按请求协议判断；全站 HTTPS 时建议设 `true`；纯 HTTP 内网演示需 `false`，否则浏览器不会回传 Cookie |
| `APP_ORIGIN` | | 空 | 额外允许的 Origin（如 `https://chat.example.com`），用于 CSRF 来源校验 |
| `UPLOAD_DIR` | | `./data/uploads` | 图片存储目录，compose 挂载到 named volume |
| `TRUST_PROXY` | | `true` | 是否信任反代的 `X-Forwarded-*` |

启动时会用 zod 校验，缺项会打印：

```
[启动失败] 环境变量配置有误：
  - SESSION_SECRET: SESSION_SECRET 至少需要 32 个字符（建议 openssl rand -hex 32）
```

---

## 角色与权限矩阵

| 操作 | 群主 | 管理员 | 成员 |
| --- | --- | --- | --- |
| 编辑群公告 | ✅ | ✅ | ❌ 403 |
| 审批入群申请 | ✅ | ✅ | ❌ 403 |
| 禁言成员 | ✅ | ✅（仅普通成员） | ❌ |
| 撤回/删除消息 | ✅ | ✅ | 仅自己 2 分钟内 |
| 任命 / 撤销管理员 | ✅ | ❌ | ❌ |
| 踢人 | ✅ | ✅（仅普通成员） | ❌ |
| 改群名 / 群头像 / 解散群 | ✅ | ❌ | ❌ |
| 转让群主 | ✅ | ❌ | ❌ |
| 发消息 / 退群 | ✅（需先转让） | ✅ | ✅ |

硬性边界（后端强制，前端只是隐藏按钮）：

- 群主不能被踢、不能被降级、不能被禁言；
- 管理员不能操作群主，也不能操作其他管理员；
- 任何人都不能踢自己（退群走独立接口 `POST /api/groups/:id/leave`）；
- 转让群主后，原群主自动降为管理员。

---

## 安全实现

| 要求 | 做法 |
| --- | --- |
| 密码存储 | `bcryptjs` cost 12，每条记录独立盐；不落明文、不用 MD5/SHA1 |
| 密码强度 | 前后端各校验一次：**至少 8 位**。按要求不限制字符类型、不拦常见口令（`12345678` 也能注册）；如需收紧，只改 `server/password.ts` 与登录页提示即可 |
| 会话 | 数据库 `Session` 表存 `HMAC-SHA256(SESSION_SECRET, token)`，Cookie 只放原始 token：`httpOnly` + `SameSite=Lax` + 按协议自动 `Secure`，7 天滚动续期 |
| 登出 / 改密 | 登出删除会话行；改密删除该用户其它所有会话（当前设备保留） |
| 登录防爆破 | 同一账号连续 5 次失败锁定 15 分钟，返回剩余秒数并倒计时；同一 IP 10 次/分钟，超出 429 |
| 账号枚举 | 登录失败统一「账号或密码不正确」；账号不存在时也执行一次 bcrypt 比较，避免时间侧信道 |
| CSRF | 双提交 Cookie（`sy_csrf`，非 httpOnly）+ `X-CSRF-Token` 头，同时校验 `Origin` |
| XSS | React 默认转义；群公告的 markdown 用自建解析器生成 React 节点，**不注入 HTML**，链接仅允许 http/https |
| SQL 注入 | 全部走 Prisma 参数化查询 |
| 越权 | 每个业务接口先 `requireAuth`，再 `requireMember` / `requireRole`，越权统一 403 |
| 上传 | 仅 image/*、≤5MB、随机文件名；取图时校验「你是该图片所属消息所在群的成员」 |
| 审计 | 登录、锁定、改密、踢人、改角色、禁言、撤回/删除、改公告、审批、解散等写入 `AuditLog` |
| 日志 | 只输出到 stdout/stderr；pino redact 掉 cookie / authorization / set-cookie；不打印请求体 |

---

## 主要接口

```
POST   /api/auth/register          注册（用户名 3–20 位字母数字下划线，邮箱唯一）
POST   /api/auth/login             登录（账号或邮箱）
POST   /api/auth/logout            登出（立即失效）
GET    /api/auth/me                当前用户
POST   /api/auth/password          改密（其它设备下线）

GET    /api/groups                 我的群（含未读数、最后一条消息）
GET    /api/groups/discover        发现群组
POST   /api/groups                 建群（创建者为群主）
GET    /api/groups/:id             群详情（成员、公告、我的角色）
PATCH  /api/groups/:id             改群名/简介/头像色（群主）
DELETE /api/groups/:id             解散群（群主）

GET    /api/groups/:id/messages    历史消息（before / after 游标 + limit）
POST   /api/groups/:id/messages    发消息（文本 / 图片）
DELETE /api/messages/:id           撤回（本人 2 分钟内）或删除（管理员）
POST   /api/groups/:id/read        上报已读位置

GET    /api/groups/:id/announcement   读公告
PUT    /api/groups/:id/announcement   改公告（群主/管理员，实时广播）

POST   /api/groups/:id/join-requests              申请入群
GET    /api/groups/:id/join-requests              待审批列表（群主/管理员）
POST   /api/groups/:id/join-requests/:rid/handle  通过 / 拒绝（可填理由）
GET    /api/join-requests/mine                    我的申请与结果

POST   /api/groups/:id/members/:uid/role    任命/撤销管理员（群主）
POST   /api/groups/:id/members/:uid/mute    禁言 / 解除
DELETE /api/groups/:id/members/:uid         踢人（不能踢自己）
POST   /api/groups/:id/transfer             转让群主
POST   /api/groups/:id/leave                主动退群

GET    /api/users?q=              找人（昵称 / 用户名 / 拾语号）
POST   /api/direct                打开或创建与某人的私聊

POST   /api/uploads                上传图片（≤5MB）
GET    /api/uploads/:name          取图（校验群成员身份）
GET    /api/health                 健康检查
WS     /ws                         实时通道（消息、公告、成员、输入中、在线状态）
```

---

## 自检结果

接口与权限部分由 `node scripts/verify.mjs` 自动跑（本机实测 49 项全通过），界面部分用无头浏览器截图与 DOM 测量核对。

| # | 验收项 | 结果 | 验证方式 |
| --- | --- | --- | --- |
| 1 | 注册 → 登录 → 申请入群 → 管理员审批 → 发言 → 另一账号实时收到 | ✅ | 自检脚本全链路用例，WebSocket 断言收到 `message:new` |
| 2 | 连续输错 5 次被锁定并显示剩余时间 | ✅ | 脚本断言 429 + `retryAfter≈900`；登录页显示「已锁定，14 分 59 秒后重试」 |
| 3 | 普通成员调用改公告 / 踢人接口返回 403 | ✅ | 脚本断言 `forbidden`；管理员审批列表同样 403 |
| 4 | 群主可任命管理员；管理员无法操作群主 | ✅ | 脚本断言任命成功，禁言/踢/降级群主均 403 `owner_protected` |
| 5 | 改公告后所有成员实时看到，且显示更新人与时间 | ✅ | 脚本断言 `announcement:updated` 携带编辑人；右侧公告卡显示「林知远 · 3 小时前更新」 |
| 6 | 刷新保持登录；登出后旧 token 立即失效 | ✅ | 脚本用登出前的 Cookie 请求返回 401；浏览器刷新后仍在会话内 |
| 7 | 1920 / 1440 / 1280 无横向滚动、无错位 | ✅ | 三档宽度实测 `documentElement.scrollWidth === innerWidth`，截图核对无错位 |
| 8 | 断网恢复能自动重连并补拉消息 | ✅ | CDP 断网模拟：出现断线提示条，恢复 1 秒内消失，断网期间对方发的消息被补拉进列表 |
| 9 | 全站无占位文本、无 emoji 功能图标、无假数据 | ✅ | 文案与图标逐屏核对，数据全部来自 seed |
| 9.1 | 私聊：发起会话、对端实时收到、不可当群管理 | ✅ | 脚本实测：私聊消息 WebSocket 到达，改群名返回 403 `direct_conversation` |
| 9.2 | 拾语号 / 群号唯一且可搜索 | ✅ | 注册自动分配 100001…、建群 500001…，按号搜人与搜群均命中 |
| 10 | 空环境 `docker compose up -d` 60 秒内可访问 | ⚠️ 需你本机验证 | 本机未安装 Docker；镜像构建、迁移、健康检查配置已就绪 |
| 11 | `down` 再 `up` 后数据仍在 | ⚠️ 需你本机验证 | 数据落 `db_data` named volume |
| 12 | 容器以非 root 运行 | ⚠️ 需你本机验证 | Dockerfile 中 `adduser app` + `USER app` |
| 13 | 镜像内不含 .env / node_modules 源码 / .git | ⚠️ 需你本机验证 | `.dockerignore` 排除；运行阶段 `npm ci --omit=dev` |
| 14 | 删掉密钥后启动立即失败并给出明确报错 | ✅ | 清空 `SESSION_SECRET` 启动，stderr 打印缺失项并 `exit 1` |
| 15 | healthcheck 为 healthy | ⚠️ 需你本机验证 | Dockerfile 与 compose 均配置 `HEALTHCHECK`，命中 `/api/health` |

> 第 10–13、15 项依赖 Docker 守护进程，当前开发机没有 Docker，所以没有实际执行——这一点如实标注，不假装跑过。
> 其余项目在本机用 `scripts/verify.mjs`（接口/权限/实时）、无头浏览器（布局/断网/交互）实测。
> 另外做过一次「只装生产依赖 + 跑编译产物」的模拟（`npm ci --omit=dev` 后启动），确认运行阶段没有漏装依赖。

---

## 部署到 Cloudflare Containers（可选）

仓库里已经带好 `wrangler.jsonc` 和 `worker/index.ts`：Worker 把请求转给唯一的容器实例（含 WebSocket 升级），容器里跑的就是本项目的 Dockerfile。

**前提**：Workers Paid 计划；一个外部 Postgres（Neon / Supabase 免费层即可，容器本身没有数据库）。

**用 Workers Builds 部署（不需要本机 Docker）**

1. 代码推到 GitHub，在 Cloudflare 控制台 **Workers & Pages → Create → Connect to Git** 选中仓库。
2. 表单这样填：
   - 构建命令：`npm ci`
   - 部署命令：`npx wrangler deploy`
   - 预览命令：留空（容器 Worker 不生成预览 URL）
   - 启用预览构建：关闭
3. 创建后在 **Settings → Variables and Secrets** 添加：
   - `DATABASE_URL`（secret）：`postgresql://...?sslmode=require`
   - `SESSION_SECRET`（secret）：`openssl rand -hex 32`
   - `SEED`（可选，明文）：`false`
4. 重新部署一次；首次部署容器要几分钟预热。

**用本机 Docker 部署**：`npm run cf:deploy`（需要 Docker 在跑），首次同样要等容器预热。

**Cloudflare 上的限制**（和 compose 部署不同）：

- 容器磁盘是临时的，**上传的图片重启后会丢**；要长期保留需要接 R2。
- 单实例运行（`idFromName('shiyu-main')`），内存限流和 WebSocket 广播都在这个实例里；水平扩展要先改造成 Redis + 多实例路由。
- 空闲 30 分钟容器会休眠，下个请求冷启动约 1–3 秒；有 WebSocket 连接时不会休眠。

---

## 部署说明与已知限制

- **单副本部署**：WebSocket 连接与内存限流都在进程内，`docker compose` 默认就是一个 app 副本。
- **水平扩展需要额外改造**：多副本时消息广播要换成 Redis Pub/Sub，限流计数要落到 Redis，
  并且反向代理需要 **sticky session**（同一会话落到同一副本），否则实时消息会只到达部分连接。
- **反向代理**：Nginx / Traefik 需转发 WebSocket upgrade（`Upgrade`、`Connection` 头），并透传 `X-Forwarded-Proto`，
  同时把 `COOKIE_SECURE` 设为 `true`（HTTPS 场景）。
- **上传目录**：单副本挂 named volume 即可；多副本需对象存储或共享卷。
- **限流是内存实现**：重启后计数清零，这是有意的取舍（不引入 Redis 依赖）。

---

## 常用脚本

```bash
npm run dev            # 本地开发（前后端同时起）
npm run build          # 编译后端 + 构建前端
npm start              # 跑生产构建
npm run seed           # 写入演示数据（幂等）
npm run db:dev         # 本地 SQLite 建表 + 生成客户端
npm run db:pg:migrate  # 生产 Postgres 迁移
npm run db:sync        # 由 schema.prisma 生成 sqlite 版 schema
npm run verify          # 接口级自检（需服务已启动，约 3 分钟，含限流/锁定等待）
node scripts/flows.mjs  # 界面截图（需先以 --remote-debugging-port=9222 启动 Chrome/Edge）
```
