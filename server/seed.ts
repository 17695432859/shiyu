import bcrypt from 'bcryptjs'
import { prisma } from './db'
import { avatarColorFor } from './lib/serialize'

const DEMO_PASSWORD = 'Shiyu@2026Demo'
const GROUP_NAME = '拾语产品组'

type SeedUser = { username: string; email: string; role: 'owner' | 'admin' | 'member'; display: string }

const USERS: SeedUser[] = [
  { username: 'chenyan', email: 'chenyan@shiyu.dev', role: 'owner', display: '陈砚' },
  { username: 'linzhiyuan', email: 'linzhiyuan@shiyu.dev', role: 'admin', display: '林知远' },
  { username: 'suwan', email: 'suwan@shiyu.dev', role: 'admin', display: '苏晚' },
  { username: 'zhoumu', email: 'zhoumu@shiyu.dev', role: 'member', display: '周牧' },
  { username: 'heyinuo', email: 'heyinuo@shiyu.dev', role: 'member', display: '何一诺' },
  { username: 'xuqinghe', email: 'xuqinghe@shiyu.dev', role: 'member', display: '许清和' },
  { username: 'gubei', email: 'gubei@shiyu.dev', role: 'member', display: '顾北' },
  { username: 'shenyiran', email: 'shenyiran@shiyu.dev', role: 'member', display: '沈亦然' },
  { username: 'jiangjinyue', email: 'jiangjinyue@shiyu.dev', role: 'member', display: '江浸月' },
  { username: 'luoqinghe', email: 'luoqinghe@shiyu.dev', role: 'member', display: '罗青禾' },
  { username: 'wenyan', email: 'wenyan@shiyu.dev', role: 'member', display: '温言' },
]

const APPLICANT = { username: 'bailu', email: 'bailu@shiyu.dev', display: '白露' }

const MINUTE = 60_000
const HOUR = 60 * MINUTE

async function main() {
  const existingGroup = await prisma.group.findFirst({ where: { name: GROUP_NAME } })
  if (existingGroup) {
    console.log('[seed] 演示数据已存在，跳过')
    return
  }

  console.log('[seed] 正在写入演示数据…')
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 12)

  const created = new Map<string, string>()
  for (const [index, user] of USERS.entries()) {
    const row = await prisma.user.upsert({
      where: { username: user.username },
      create: {
        public_id: 100001 + index,
        username: user.username,
        display_name: user.display,
        email: user.email,
        password_hash: passwordHash,
        avatar_color: avatarColorFor(user.username),
      },
      update: {},
    })
    created.set(user.username, row.id)
  }

  const applicant = await prisma.user.upsert({
    where: { username: APPLICANT.username },
    create: {
      public_id: 100001 + USERS.length,
      username: APPLICANT.username,
      display_name: APPLICANT.display,
      email: APPLICANT.email,
      password_hash: passwordHash,
      avatar_color: avatarColorFor(APPLICANT.username),
    },
    update: {},
  })

  const ownerId = created.get('chenyan')!
  const group = await prisma.group.create({
    data: {
      type: 'group',
      public_id: 500001,
      name: GROUP_NAME,
      description: '拾语的第一块试验田：产品、设计与工程在这里对齐节奏。',
      avatar_color: avatarColorFor(GROUP_NAME),
      owner_id: ownerId,
      created_at: new Date(Date.now() - 26 * HOUR),
    },
  })

  for (const user of USERS) {
    await prisma.membership.create({
      data: {
        group_id: group.id,
        user_id: created.get(user.username)!,
        role: user.role,
        joined_at: new Date(Date.now() - 25 * HOUR),
      },
    })
  }

  const now = Date.now()
  const announcementTime = new Date(now - 3 * HOUR)
  await prisma.announcement.create({
    data: {
      group_id: group.id,
      content: [
        '**本周迭代节奏**',
        '- 周一 10:30 需求对齐，会议室 A',
        '- 周三 18:00 提测，自测通过后再提交',
        '- 周五 16:00 复盘，结论同步到这里',
        '',
        '上线窗口调整为周四 21:00，请提前合并代码。',
      ].join('\n'),
      mention_all: true,
      updated_by: created.get('linzhiyuan')!,
      updated_at: announcementTime,
    },
  })

  // 约 20 条有真实感的历史消息，时间跨越昨天与今天
  const script: Array<{ who: string; minutesAgo: number; text: string }> = [
    { who: 'chenyan', minutesAgo: 1580, text: '早，今天先把群公告的权限收紧一下，只有管理员能改。' },
    { who: 'linzhiyuan', minutesAgo: 1560, text: '收到，我下午把公告模板整理出来，顺便把 @全体 的用法写清楚。' },
    { who: 'suwan', minutesAgo: 1545, text: '设计稿更新到第二版了，主要改了成员列表的分组方式，按角色分三段。' },
    { who: 'zhoumu', minutesAgo: 1530, text: '三段会不会有点长？成员多的时候右侧面板要滚很久。' },
    { who: 'suwan', minutesAgo: 1522, text: '不会，每段默认折叠，只展开自己所在的那一段。' },
    { who: 'chenyan', minutesAgo: 1510, text: '这个可以。另外未读数那块，先把「只统计别人发的消息」定下来。' },
    { who: 'heyinuo', minutesAgo: 1495, text: '前端这边今天能出第一版消息列表，虚拟滚动我先按固定行高做，后面再改成动态测量。' },
    { who: 'linzhiyuan', minutesAgo: 1480, text: '注意撤回的消息也要占位，不然滚动位置会跳。' },
    { who: 'heyinuo', minutesAgo: 1476, text: '记下了，撤回的保留一行灰字。' },
    { who: 'xuqinghe', minutesAgo: 1440, text: '接口这边有个问题：拉历史消息用 before 游标还是 offset？' },
    { who: 'chenyan', minutesAgo: 1432, text: '用游标，消息 id 自增，翻页稳定，offset 在有人发新消息时会重复。' },
    { who: 'xuqinghe', minutesAgo: 1428, text: '好，那我按 id 做游标，顺便把 after 也加上，断线重连时补拉。' },
    { who: 'gubei', minutesAgo: 1380, text: '提测前我跑一遍权限矩阵，重点看管理员能不能动群主。' },
    { who: 'chenyan', minutesAgo: 1372, text: '这个必须有测试用例，管理员操作群主一律 403，别只在前端藏按钮。' },
    { who: 'gubei', minutesAgo: 1368, text: '明白，我直接打接口测。' },
    { who: 'shenyiran', minutesAgo: 300, text: '图片上传压了一下，5MB 以内的手机直出图基本都能过，超过的给明确提示。' },
    { who: 'jiangjinyue', minutesAgo: 280, text: '上传的图走鉴权吗？别让人拿到链接就能看。' },
    { who: 'shenyiran', minutesAgo: 272, text: '走的，取图会校验你是不是这个群的成员。' },
    { who: 'luoqinghe', minutesAgo: 120, text: '公告我补了一条上线窗口，大家看一下措辞有没有问题。' },
    { who: 'linzhiyuan', minutesAgo: 96, text: '没问题，我把「请提前合并代码」加粗了，醒目一点。' },
    { who: 'wenyan', minutesAgo: 42, text: '刚在群里试了下 @ 提及，输入 @ 之后弹出来的成员列表挺顺的。' },
    { who: 'chenyan', minutesAgo: 20, text: '那就按这个节奏走。今晚 21:00 前把提测分支合了，明早我来看结果。' },
  ]

  let lastMessageId = 0
  for (const item of script) {
    const message = await prisma.message.create({
      data: {
        group_id: group.id,
        sender_id: created.get(item.who)!,
        content: item.text,
        type: 'text',
        created_at: new Date(now - item.minutesAgo * MINUTE),
      },
    })
    lastMessageId = Math.max(lastMessageId, message.id)
  }

  // 已读位置：群主与管理员读到最新，普通成员各留一些未读
  const readUntil: Record<string, number> = {
    chenyan: lastMessageId,
    linzhiyuan: lastMessageId,
    suwan: lastMessageId - 1,
    zhoumu: lastMessageId - 2,
    heyinuo: lastMessageId - 5,
    xuqinghe: lastMessageId - 4,
    gubei: lastMessageId - 8,
    shenyiran: lastMessageId - 3,
    jiangjinyue: lastMessageId - 6,
    luoqinghe: lastMessageId - 2,
    wenyan: lastMessageId - 1,
  }
  for (const [username, id] of Object.entries(readUntil)) {
    await prisma.readState.create({
      data: { group_id: group.id, user_id: created.get(username)!, last_read_message_id: id },
    })
  }

  // 第二个群：用于演示「发现群组 → 申请加入」的流程（当前账号不在其中）
  const reviewGroup = await prisma.group.create({
    data: {
      type: 'group',
      public_id: 500002,
      name: '设计评审室',
      description: '每周三晚上的设计评审，随手记录结论与待办。',
      avatar_color: avatarColorFor('设计评审室'),
      owner_id: created.get('suwan')!,
      created_at: new Date(Date.now() - 40 * HOUR),
      memberships: {
        create: [
          { user_id: created.get('suwan')!, role: 'owner' },
          { user_id: created.get('wenyan')!, role: 'member' },
          { user_id: created.get('jiangjinyue')!, role: 'member' },
        ],
      },
    },
  })

  const reviewMessages: Array<{ who: string; minutesAgo: number; text: string }> = [
    { who: 'suwan', minutesAgo: 2600, text: '这周的评审主题：消息密度和留白。大家先把截图贴上来。' },
    { who: 'wenyan', minutesAgo: 2560, text: '我把上周那版的间距标了一下，正文到气泡边缘统一 12。' },
    { who: 'jiangjinyue', minutesAgo: 2520, text: '同意，另外时间戳建议只在 hover 时出现，别一直占位。' },
  ]
  for (const item of reviewMessages) {
    await prisma.message.create({
      data: {
        group_id: reviewGroup.id,
        sender_id: created.get(item.who)!,
        content: item.text,
        created_at: new Date(now - item.minutesAgo * MINUTE),
      },
    })
  }

  // 两个私聊会话：演示「私聊」列表与一对一会话
  const directSeeds = [
    {
      a: 'chenyan',
      b: 'linzhiyuan',
      publicId: 500003,
      messages: [
        { who: 'linzhiyuan', minutesAgo: 320, text: '公告模板我放到文档里了，你看下措辞。' },
        { who: 'chenyan', minutesAgo: 312, text: '看了，@全体 那条建议放最后，别一上来就喊人。' },
        { who: 'linzhiyuan', minutesAgo: 305, text: '有道理，我改一下再发。' },
        { who: 'chenyan', minutesAgo: 298, text: '嗯，改完直接发就行，不用再问我。' },
      ],
    },
    {
      a: 'chenyan',
      b: 'suwan',
      publicId: 500004,
      messages: [
        { who: 'suwan', minutesAgo: 1500, text: '右侧成员列表的折叠方案我做了两版，晚点发你。' },
        { who: 'chenyan', minutesAgo: 1490, text: '好，顺便把管理员那一组的默认展开也考虑进去。' },
        { who: 'suwan', minutesAgo: 1482, text: '收到，我按「只展开自己所在分组」再调一版。' },
      ],
    },
  ]

  for (const dm of directSeeds) {
    const direct = await prisma.group.create({
      data: {
        type: 'direct',
        public_id: dm.publicId,
        name: '',
        description: '',
        avatar_color: avatarColorFor(dm.b),
        owner_id: created.get(dm.a)!,
        created_at: new Date(now - 30 * HOUR),
        memberships: {
          create: [
            { user_id: created.get(dm.a)!, role: 'member' },
            { user_id: created.get(dm.b)!, role: 'member' },
          ],
        },
      },
    })
    let lastId = 0
    for (const item of dm.messages) {
      const message = await prisma.message.create({
        data: {
          group_id: direct.id,
          sender_id: created.get(item.who)!,
          content: item.text,
          created_at: new Date(now - item.minutesAgo * MINUTE),
        },
      })
      lastId = Math.max(lastId, message.id)
    }
    for (const who of [dm.a, dm.b]) {
      await prisma.readState.create({
        data: { group_id: direct.id, user_id: created.get(who)!, last_read_message_id: lastId },
      })
    }
  }

  // 一条待审批的入群申请，方便直接验证审批流程
  await prisma.joinRequest.create({
    data: {
      group_id: group.id,
      user_id: applicant.id,
      status: 'pending',
      reason: '在做同类产品的体验调研，想进群看看你们的公告和消息组织方式。',
      created_at: new Date(now - 40 * MINUTE),
    },
  })

  await prisma.auditLog.create({
    data: {
      actor_id: ownerId,
      action: 'group.create',
      target: `group:${group.id}`,
      meta: JSON.stringify({ name: GROUP_NAME, seeded: true }),
      created_at: new Date(now - 26 * HOUR),
    },
  })

  console.log(`[seed] 完成：${USERS.length} 个账号 + 1 个申请人，${script.length} 条主群消息 + 1 个用于演示发现流程的群`)
  console.log(`[seed] 测试密码统一为 ${DEMO_PASSWORD}`)
}

main()
  .catch((err) => {
    console.error('[seed] 失败', err)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
