import { app } from 'electron'
import { AsyncEntry } from '@napi-rs/keyring'
app.whenReady().then(async () => {
  const e = new AsyncEntry('co.klei.bridal.electron.preview.spike', 'refresh-token')
  await e.deletePassword().catch(() => {})
  const out = [await e.getPassword()]
  await e.setPassword('tok-e'); out.push(await e.getPassword())
  await e.deletePassword(); out.push(await e.getPassword())
  console.log('in-electron', JSON.stringify(out), process.versions.electron, process.arch)
  app.quit()
})
setTimeout(() => { console.log('HANG (prompt?)'); process.exit(4) }, 20000)
