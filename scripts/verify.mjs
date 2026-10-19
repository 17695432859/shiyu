// 接口级自检：权限矩阵 / 登录锁定 / 限流 / CSRF / 实时推送 / 会话失效
// 用法：node scripts/verify.mjs   （需先启动服务，默认 http://127.0.0.1:3000）
import WebSocket from 'ws'
import fs from 'node:fs'
import path from 'node:path'
import { PrismaClient } from '@prisma/client'

const BASE = process.env.BASE || 'http://127.0.0.1:3000'
const PASSWORD = 'Shiyu@2026Demo'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function loadEnv() {
  const file = path.resolve('.env')
  if (!fs.existsSync(file)) return
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const i = t.indexOf('=')
    if (i < 0) continue
    const k = t.slice(0, i).trim()
    const v = t.slice(i + 1).trim()
    if (process.env[k] === undefined) process.env[k] = v
  }
}
loadEnv()

const prisma = new PrismaClient()

class Client {
  constructor(label) {
    this.label = label
    this.cookies = new Map()
  }

  cookieHeader() {
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ')
  }

  async req(method, pathname, body, opts = {}) {
    const headers = {}
    if (body !== undefined) headers['content-type'] = 'application/json'
    if (this.cookies.get('sy_csrf') && !opts.noCsrf) headers['x-csrf-token'] = this.cookies.get('sy_csrf')
    if (this.cookies.size) headers.cookie = this.cookieHeader()
    if (opts.origin) headers.origin = opts.origin

    const res = await fetch(BASE + pathname, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'manual',
    })

    const setCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : []
    for (const raw of setCookies) {
      const [pair] = raw.split(';')
      const i = pair.indexOf('=')
      if (i < 0) continue
      const key = pair.slice(0, i).trim()
      const value = pair.slice(i + 1).trim()
      if (!value || /expires=thu, 01 jan 1970/i.test(raw)) this.cookies.delete(key)
      else this.cookies.set(key, value)
    }

    let data = null
    const text = await res.text()
    if (text) {
      try {
        data = JSON.parse(text)
      } catch {
        data = text
      }
    }
    return { status: res.status, data, headers: res.headers }
  }

  get(pathname) {
    return this.req('GET', pathname)
  }
  post(pathname, body, opts) {
    return this.req('POST', pathname, body, opts)
  }
  put(pathname, body, opts) {
    return this.req('PUT', pathname, body, opts)
  }
  del(pathname, body, opts) {
    return this.req('DELETE', pathname, body, opts)
  }

  async login(identifier, password = PASSWORD) {
    await this.get('/api/auth/csrf')
    return this.post('/api/auth/login', { identifier, password })
  }
}

const results = []
function check(name, ok, detail = '') {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

function openSocket(client) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:3000/ws`, { headers: { cookie: client.cookieHeader() } })
    ws.on('open', () => resolve(ws))
    ws.on('error', reject)
    setTimeout(() => reject(new Error('ws 连接超时')), 5000)
  })
}

function waitEvent(ws, predicate, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off('message', onMessage)
      reject(new Error('等待事件超时'))
    }, timeout)
    const onMessage = (raw) => {
      let data
      try {
        data = JSON.parse(String(raw))
      } catch {
        return
      }
      if (predicate(data)) {
        clearTimeout(timer)
        ws.off('message', onMessage)
        resolve(data)
      }
    }
    ws.on('message', onMessage)
  })
}

async function main() {
  const stamp = Date.now().toString().slice(-6)

  // 0. 健康检查
  const health = await fetch(`${BASE}/api/health`)
  const healthBody = await health.json()
  check('健康检查 /api/health', health.status === 200 && healthBody.db === 'up', JSON.stringify(healthBody))

  // 1. 注册：弱密码必须被拒绝
  const anon = new Client('anon')
  await anon.get('/api/auth/csrf')
  const weak = await anon.post('/api/auth/register', {
    username: `weak${stamp}`,
    displayName: '七位密码',
    email: `weak${stamp}@test.dev`,
    password: '1234567',
  })
  check('不足 8 位密码被拒绝', weak.status === 400 && weak.data?.error?.code === 'weak_password', weak.data?.error?.message)

  const simplePw = await anon.post('/api/auth/register', {
    username: `simple${stamp}`,
    displayName: '纯数字密码',
    email: `simple${stamp}@test.dev`,
    password: '12345678',
  })
  check('纯数字密码可注册（宽松策略）', simplePw.status === 200, simplePw.data?.error?.message)

  const shortPw = await anon.post('/api/auth/register', {
    username: `short${stamp}`,
    displayName: '短密码',
    email: `short${stamp}@test.dev`,
    password: 'Ab1!',
  })
  check('不足 8 位密码被拒绝', shortPw.status === 400, shortPw.data?.error?.message)

  const badName = await anon.post('/api/auth/register', {
    username: 'ab',
    displayName: '短名',
    email: `bad${stamp}@test.dev`,
    password: 'abc12345',
  })
  check('用户名格式校验', badName.status === 400, badName.data?.error?.message)

  // 2. 正常注册
  const newUser = new Client('new')
  await newUser.get('/api/auth/csrf')
  const reg = await newUser.post('/api/auth/register', {
    username: `tester${stamp}`,
    displayName: '测试员',
    email: `tester${stamp}@test.dev`,
    password: 'Zx!9aBcDeFg7',
  })
  check('正常注册成功', reg.status === 200 && !!reg.data?.user?.id, reg.data?.user?.name)

  const dupEmail = await anon.post('/api/auth/register', {
    username: `other${stamp}`,
    displayName: '重复邮箱',
    email: `tester${stamp}@test.dev`,
    password: 'Zx!9aBcDeFg7',
  })
  check('邮箱唯一性校验', dupEmail.status === 409 && dupEmail.data?.error?.code === 'email_taken', dupEmail.data?.error?.message)

  const me = await newUser.get('/api/auth/me')
  check('注册后会话可用', me.status === 200 && me.data?.user?.username === `tester${stamp}`)

  // 3. CSRF 防护
  const noCsrf = await newUser.post('/api/groups', { name: '无令牌群组' }, { noCsrf: true })
  check('缺少 CSRF 令牌被拒绝', noCsrf.status === 403 && noCsrf.data?.error?.code === 'csrf_failed')

  const badOrigin = await newUser.post('/api/groups', { name: '跨站群组' }, { origin: 'https://evil.example.com' })
  check('跨站 Origin 被拒绝', badOrigin.status === 403)

  // 4. 未登录访问业务接口
  const guest = new Client('guest')
  const guestGroups = await guest.get('/api/groups')
  check('未登录访问业务接口返回 401', guestGroups.status === 401)

  // 5. 登出后旧会话立即失效
  const sessionBefore = newUser.cookieHeader()
  await newUser.post('/api/auth/logout')
  const afterLogout = await fetch(`${BASE}/api/auth/me`, { headers: { cookie: sessionBefore } })
  check('登出后旧 Cookie 立即失效', afterLogout.status === 401)

  // 6. 登录既有账号
  const owner = new Client('owner')
  const ownerLogin = await owner.login('chenyan')
  check('群主登录成功', ownerLogin.status === 200, ownerLogin.data?.user?.name)

  const member = new Client('member')
  const memberLogin = await member.login('zhoumu')
  check('成员登录成功', memberLogin.status === 200, memberLogin.data?.user?.name)

  const admin = new Client('admin')
  await admin.login('linzhiyuan')

  const groups = await owner.get('/api/groups')
  const group = groups.data?.groups?.[0]
  check('群列表返回数据', !!group?.id, group?.name)
  if (!group) throw new Error('没有可用的演示群组')

  const memberGroups = await member.get('/api/groups')
  check('成员可见未读消息', (memberGroups.data?.groups?.[0]?.unread ?? 0) > 0, `未读 ${memberGroups.data?.groups?.[0]?.unread}`)

  // 7. 权限矩阵：普通成员越权
  const memberAnnounce = await member.put(`/api/groups/${group.id}/announcement`, { content: '越权改公告', mention_all: false })
  check('成员改公告返回 403', memberAnnounce.status === 403 && memberAnnounce.data?.error?.code === 'forbidden')

  const memberKick = await member.del(`/api/groups/${group.id}/members/${group.owner_id}`)
  check('成员踢人返回 403', memberKick.status === 403)

  const memberRequests = await member.get(`/api/groups/${group.id}/join-requests`)
  check('成员查看审批列表返回 403', memberRequests.status === 403)

  const memberKickAdmin = await member.del(`/api/groups/${group.id}/members/${(await admin.get('/api/auth/me')).data.user.id}`)
  check('成员踢管理员返回 403', memberKickAdmin.status === 403)

  // 8. 群主任命管理员，管理员不能操作群主
  const memberId = (await member.get('/api/auth/me')).data.user.id
  const promote = await owner.post(`/api/groups/${group.id}/members/${memberId}/role`, { role: 'admin' })
  check('群主任命管理员', promote.status === 200, promote.data?.error?.message ?? '')

  const adminMuteOwner = await member.post(`/api/groups/${group.id}/members/${group.owner_id}/mute`, { minutes: 30 })
  check('管理员禁言群主被拒绝', adminMuteOwner.status === 403 && adminMuteOwner.data?.error?.code === 'owner_protected', adminMuteOwner.data?.error?.message)

  const adminKickOwner = await member.del(`/api/groups/${group.id}/members/${group.owner_id}`)
  check('管理员踢群主被拒绝', adminKickOwner.status === 403)

  const adminDemoteOwner = await member.post(`/api/groups/${group.id}/members/${group.owner_id}/role`, { role: 'member' })
  check('管理员降级群主被拒绝', adminDemoteOwner.status === 403)

  const selfKick = await member.del(`/api/groups/${group.id}/members/${memberId}`)
  check('任何人都不能踢自己', selfKick.status === 400)

  const demote = await owner.post(`/api/groups/${group.id}/members/${memberId}/role`, { role: 'member' })
  check('群主撤销管理员', demote.status === 200)

  // 9. 实时：成员收到新消息
  const socket = await openSocket(member)
  const waitMsg = waitEvent(socket, (d) => d.t === 'message:new')
  const sent = await owner.post(`/api/groups/${group.id}/messages`, { content: `自检消息 ${stamp}`, type: 'text' })
  check('发送消息成功', sent.status === 201 && !!sent.data?.message?.id)
  let realtimeOk = false
  let realtimeDetail = ''
  try {
    const evt = await waitMsg
    realtimeOk = evt.message?.content === `自检消息 ${stamp}`
    realtimeDetail = `收到 message:new #${evt.message?.id}`
  } catch (err) {
    realtimeDetail = err.message
  }
  check('另一账号通过 WebSocket 实时收到', realtimeOk, realtimeDetail)

  // 10. 公告更新实时下发
  const waitAnn = waitEvent(socket, (d) => d.t === 'announcement:updated')
  const annUpdate = await admin.put(`/api/groups/${group.id}/announcement`, {
    content: `**自检公告** ${stamp}\n- 权限校验通过`,
    mention_all: true,
  })
  check('管理员可编辑公告', annUpdate.status === 200)
  let annOk = false
  let annDetail = ''
  try {
    const evt = await waitAnn
    annOk = evt.announcement?.editor?.name === '林知远' && !!evt.announcement?.updated_at
    annDetail = `编辑人 ${evt.announcement?.editor?.name}`
  } catch (err) {
    annDetail = err.message
  }
  check('公告更新实时推送且带编辑人', annOk, annDetail)

  // 11. 撤回与实时删除
  const target = sent.data.message
  const waitDel = waitEvent(socket, (d) => d.t === 'message:deleted' && d.message_id === target.id)
  const recalled = await owner.del(`/api/messages/${target.id}`)
  check('发送者 2 分钟内撤回', recalled.status === 200)
  let delOk = false
  try {
    await waitDel
    delOk = true
  } catch {
    delOk = false
  }
  check('撤回事件实时推送', delOk)

  // 12. 管理员删除他人消息 / 成员不能删除他人消息
  const otherMsg = await owner.post(`/api/groups/${group.id}/messages`, { content: '待管理员删除', type: 'text' })
  const memberDelete = await member.del(`/api/messages/${otherMsg.data.message.id}`)
  check('成员删除他人消息返回 403', memberDelete.status === 403)
  const adminDelete = await admin.del(`/api/messages/${otherMsg.data.message.id}`)
  check('管理员可删除他人消息', adminDelete.status === 200)

  // 13. 非成员越权
  const outsider = new Client('outsider')
  await outsider.login('bailu')
  const outsiderRead = await outsider.get(`/api/groups/${group.id}/messages`)
  check('非成员读取群消息返回 403', outsiderRead.status === 403, outsiderRead.data?.error?.message)

  // 14. 入群申请审批（bailu 在种子数据里已有一条待审批申请）
  const pending = await owner.get(`/api/groups/${group.id}/join-requests`)
  const pendingItem = pending.data?.requests?.find((r) => r.status === 'pending')
  check('管理员能看到待审批申请', !!pendingItem, pendingItem?.user?.name)
  if (pendingItem) {
    const approve = await owner.post(`/api/groups/${group.id}/join-requests/${pendingItem.id}/handle`, {
      action: 'approve',
      reason: '',
    })
    check('审批通过入群申请', approve.status === 200)
    const mine = await outsider.get('/api/join-requests/mine')
    const handled = mine.data?.requests?.find((r) => r.id === pendingItem.id)
    check('申请人能看到审批结果', handled?.status === 'approved', handled?.status)
    const nowRead = await outsider.get(`/api/groups/${group.id}/messages`)
    check('通过后即可访问群消息', nowRead.status === 200)
  }

  // 15. 分页
  const page1 = await owner.get(`/api/groups/${group.id}/messages?limit=5`)
  const firstId = page1.data?.messages?.[0]?.id
  const page2 = await owner.get(`/api/groups/${group.id}/messages?limit=5&before=${firstId}`)
  check(
    '消息游标分页',
    page1.data?.messages?.length === 5 && page2.data?.messages?.every((m) => m.id < firstId),
    `第 1 页 ${page1.data?.messages?.length} 条，第 2 页 ${page2.data?.messages?.length} 条`
  )

  // 16. 审计日志
  const audits = await prisma.auditLog.count()
  const latest = await prisma.auditLog.findFirst({ orderBy: { created_at: 'desc' } })
  check('敏感操作写入审计日志', audits > 0, `共 ${audits} 条，最新 ${latest?.action}`)

  // 17. 图片上传：超限与类型
  const fakeForm = new FormData()
  fakeForm.append('file', new Blob([new Uint8Array(1024)], { type: 'text/plain' }), 'a.txt')
  const uploadRes = await fetch(`${BASE}/api/uploads`, {
    method: 'POST',
    headers: { cookie: owner.cookieHeader(), 'x-csrf-token': owner.cookies.get('sy_csrf') },
    body: fakeForm,
  })
  check('非图片上传被拒绝', uploadRes.status === 400, `HTTP ${uploadRes.status}`)

  // 17.5 图片消息 + 取图鉴权
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64'
  )
  const imgForm = new FormData()
  imgForm.append('file', new Blob([png], { type: 'image/png' }), 'dot.png')
  const imgUploadRes = await fetch(`${BASE}/api/uploads`, {
    method: 'POST',
    headers: { cookie: owner.cookieHeader(), 'x-csrf-token': owner.cookies.get('sy_csrf') },
    body: imgForm,
  })
  const imgUpload = await imgUploadRes.json()
  check('图片上传成功', imgUploadRes.status === 201 && !!imgUpload.path, imgUpload.path)

  const imgMessage = await owner.post(`/api/groups/${group.id}/messages`, {
    content: '',
    type: 'image',
    imagePath: imgUpload.path,
  })
  check('图片消息发送成功', imgMessage.status === 201 && imgMessage.data?.message?.image?.path === imgUpload.path)

  const memberImg = await fetch(`${BASE}/api/uploads/${imgUpload.path}`, { headers: { cookie: member.cookieHeader() } })
  check('群成员可以取图', memberImg.status === 200 && (memberImg.headers.get('content-type') || '').startsWith('image/'), memberImg.headers.get('content-type'))

  const stranger = new Client('stranger')
  await stranger.get('/api/auth/csrf')
  await stranger.post('/api/auth/register', {
    username: `stranger${stamp}`,
    displayName: '路人',
    email: `stranger${stamp}@test.dev`,
    password: 'Zx!9aBcDeFg7',
  })
  const strangerImg = await fetch(`${BASE}/api/uploads/${imgUpload.path}`, { headers: { cookie: stranger.cookieHeader() } })
  check('非成员取图返回 404', strangerImg.status === 404)

  socket.close()
  await sleep(200)

  // 18. IP 限流（10 次/分钟）——放到最后，避免影响前面的登录
  console.log('\n等待 62 秒以重置限流窗口…')
  await sleep(62000)
  const burst = new Client('burst')
  let got429 = 0
  for (let i = 0; i < 12; i++) {
    const res = await burst.post('/api/auth/login', { identifier: 'chenyan', password: 'wrong-password-1' })
    if (res.status === 429) got429++
  }
  check('同一 IP 登录限流返回 429', got429 > 0, `${got429} 次被限流`)

  // 19. 账号锁定（5 次失败）
  const lockName = `lock${stamp}`
  const lockClient = new Client('lock')
  await lockClient.get('/api/auth/csrf')
  await lockClient.post('/api/auth/register', {
    username: lockName,
    displayName: '锁定测试',
    email: `${lockName}@test.dev`,
    password: 'Zx!9aBcDeFg7',
  })
  await lockClient.post('/api/auth/logout')
  console.log('等待 62 秒以重置限流窗口…')
  await sleep(62000)
  let lockStatus = 0
  let lockMessage = ''
  let lockDetails = null
  for (let i = 0; i < 5; i++) {
    const res = await lockClient.post('/api/auth/login', { identifier: lockName, password: `Wrong!${i}aaaa` })
    lockStatus = res.status
    lockMessage = res.data?.error?.message ?? ''
    lockDetails = res.data?.error?.details ?? null
  }
  check('连续 5 次失败后锁定', lockStatus === 429 && lockDetails?.retryAfter > 800, lockMessage)

  const stillLocked = await lockClient.post('/api/auth/login', { identifier: lockName, password: 'Zx!9aBcDeFg7' })
  check('锁定期内正确密码也无法登录', stillLocked.status === 429, stillLocked.data?.error?.message)

  const failed = results.filter((r) => !r.ok)
  console.log(`\n结果：${results.length - failed.length}/${results.length} 通过`)
  if (failed.length) {
    console.log('失败项：')
    for (const f of failed) console.log(`  - ${f.name} ${f.detail}`)
    process.exitCode = 1
  }
}

main()
  .catch((err) => {
    console.error('自检异常：', err)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
