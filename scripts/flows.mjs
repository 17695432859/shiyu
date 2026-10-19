// UI 流程截图 + 横向溢出检测（本地自检用）
import WebSocket from 'ws'
import fs from 'node:fs'
import path from 'node:path'

const PORT = '9222'
const OUT = path.resolve('shots')
const BASE = 'http://127.0.0.1:3000'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
const page = list.find((t) => t.type === 'page')
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((r) => ws.on('open', r))

let id = 1
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const mid = id++
    const onMsg = (raw) => {
      const data = JSON.parse(String(raw))
      if (data.id === mid) {
        ws.off('message', onMsg)
        if (data.error) reject(new Error(`${method} ${data.error.message}`))
        else resolve(data.result)
      }
    }
    ws.on('message', onMsg)
    ws.send(JSON.stringify({ id: mid, method, params }))
  })

const evaluate = async (expression) => {
  const res = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (res.exceptionDetails) throw new Error(res.exceptionDetails.text)
  return res.result.value
}

const shot = async (name) => {
  const { data } = await send('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(data, 'base64'))
  console.log('saved', name)
}

const viewport = (width, height) =>
  send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })

const login = async () => {
  await evaluate(`(() => {
    const inputs = document.querySelectorAll('input');
    const setValue = (el, v) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(el, v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    if (inputs.length < 2) return 'skip';
    setValue(inputs[0], 'chenyan');
    setValue(inputs[1], 'Shiyu@2026Demo');
    document.querySelector('form').requestSubmit();
    return 'ok';
  })()`)
  await sleep(2400)
}

const clickByLabel = (label) =>
  evaluate(`(() => {
    const el = [...document.querySelectorAll('button')].find(b => (b.getAttribute('aria-label')||'') === ${JSON.stringify(label)});
    if (!el) return 'not-found';
    el.click();
    return 'clicked';
  })()`)

await send('Page.enable')
await send('Runtime.enable')
await send('Network.enable')
await send('Network.setCacheDisabled', { cacheDisabled: true })
await send('Network.clearBrowserCookies')
await viewport(1440, 900)
await send('Page.navigate', { url: `${BASE}/?t=${Date.now()}` })
await sleep(1600)
await login()
await shot('10-chat-default')

// 横向溢出检测
for (const [w, h] of [
  [1920, 1080],
  [1440, 900],
  [1280, 800],
]) {
  await viewport(w, h)
  await sleep(500)
  const overflow = await evaluate(
    `JSON.stringify({ w: innerWidth, scroll: document.documentElement.scrollWidth, bodyScroll: document.body.scrollWidth })`
  )
  console.log(`溢出检测 ${w}px ->`, overflow)
  await shot(`11-layout-${w}`)
}

await viewport(1440, 900)
await sleep(400)

// 群公告编辑弹窗
await evaluate(`(() => {
  const btn = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '编辑');
  btn?.click();
  return !!btn;
})()`)
await sleep(700)
await shot('12-announcement-dialog')
await evaluate(`document.querySelector('.overlay')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))`)
await sleep(400)

// 发现群组
await clickByLabel('关闭')
await evaluate(`(() => {
  const btn = [...document.querySelectorAll('button')].find(b => b.textContent.includes('发现'));
  btn?.click();
  return !!btn;
})()`)
await sleep(1200)
await shot('13-discover-dialog')
await evaluate(`document.querySelector('.overlay')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))`)
await sleep(300)

// 深色主题
await evaluate(`(() => { localStorage.setItem('shiyu.theme','dark'); location.reload(); return true })()`)
await sleep(2000)
await shot('14-dark')
await evaluate(`(() => { localStorage.setItem('shiyu.theme','system'); return true })()`)

// 移动端：进入群聊
await viewport(390, 844)
await sleep(300)
await send('Page.reload', { ignoreCache: true })
await sleep(1800)
await evaluate(`(() => {
  const item = document.querySelector('.group-item');
  item?.click();
  return !!item;
})()`)
await sleep(1500)
await shot('15-mobile-chat')

ws.close()
