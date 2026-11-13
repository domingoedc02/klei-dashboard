// Test fixture: a compromised page. window.attack(base) tries every way out and reports what happened; the test checks `base` saw no request.
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const violations = []
document.addEventListener('securitypolicyviolation', (e) => violations.push(e.violatedDirective))
const timeout = (v) => new Promise((r) => setTimeout(() => r(v), 3000))
const settle = (p) => Promise.race([p.then(() => 'allowed', () => 'blocked'), timeout('timeout')])

window.attack = async (base) => {
  const out = {}
  out.fetch = await settle(fetch(base + '/fetch', { mode: 'no-cors' }))
  out.xhr = await new Promise((r) => {
    const x = new XMLHttpRequest()
    x.onload = () => r('allowed'); x.onerror = () => r('blocked'); x.timeout = 3000; x.ontimeout = () => r('blocked')
    try { x.open('GET', base + '/xhr'); x.send() } catch { r('blocked') }
  })
  out.ws = await new Promise((r) => {
    try { const w = new WebSocket(base.replace('http', 'ws') + '/ws'); w.onopen = () => r('allowed'); w.onerror = () => r('blocked'); setTimeout(() => r('blocked'), 3000) } catch { r('blocked') }
  })
  out.eventsource = await new Promise((r) => {
    try { const e = new EventSource(base + '/es'); e.onopen = () => r('allowed'); e.onerror = () => r('blocked'); setTimeout(() => r('blocked'), 3000) } catch { r('blocked') }
  })
  out.img = await new Promise((r) => { const i = new Image(); i.onload = () => r('allowed'); i.onerror = () => r('blocked'); i.src = base + '/img.png' })
  out.iframe = await new Promise((r) => {
    const f = document.createElement('iframe'); f.onload = () => r('loaded'); f.onerror = () => r('blocked'); f.src = base + '/frame'
    document.body.append(f); setTimeout(() => r('blocked'), 500)
  })
  const wv = document.createElement('webview'); document.body.append(wv)
  out.webviewIsReal = typeof wv.getURL === 'function'

  out.open = [window.open(base + '/open'), window.open('app://klei/'), window.open('about:blank')].map((w) => (w === null ? 'denied' : 'opened'))
  const a = document.createElement('a'); a.href = base + '/blank'; a.target = '_blank'; document.body.append(a); a.click()
  const f = document.createElement('form'); f.method = 'post'; f.action = base + '/form'; document.body.append(f); f.submit()

  window.__marker = 1
  const before = location.href
  for (const to of [base + '/nav', 'file:///etc/hosts', 'data:text/html,<script>alert(1)<\/script>', 'javascript:window.__pwn=1', 'blob:app://klei/x', 'https://example.com/']) {
    location.href = to
    await wait(100)
  }
  await wait(300)
  out.stayed = location.href === before && window.__marker === 1 && window.__pwn === undefined

  out.node = [typeof require, typeof process, typeof Buffer, typeof __dirname, typeof module].every((t) => t === 'undefined')
  out.notification = await Promise.race([Notification.requestPermission(), timeout('timeout')])
  out.geolocation = await Promise.race([new Promise((r) => navigator.geolocation.getCurrentPosition(() => r('granted'), () => r('denied'))), timeout('timeout')])
  out.clipboardRead = await settle(navigator.clipboard.readText())
  out.media = await settle(navigator.mediaDevices.getUserMedia({ video: true, audio: true }))
  out.usb = await settle(navigator.usb.requestDevice({ filters: [] }))
  return { out, violations }
}
