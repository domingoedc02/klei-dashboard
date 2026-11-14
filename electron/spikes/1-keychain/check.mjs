import { AsyncEntry } from '@napi-rs/keyring'
const SERVICE = 'co.klei.bridal.electron.preview', ACCOUNT = 'refresh-token'
const e = new AsyncEntry(SERVICE, ACCOUNT)
const rows = []
const step = async (name, fn) => { try { rows.push([name, 'ok', await fn()]) } catch (x) { rows.push([name, 'ERR', String(x.message ?? x)]) } }
await e.deletePassword().catch(() => {})
await step('missing -> null', async () => (await e.getPassword()) === null ? 'null' : 'NOT NULL')
await step('store', async () => { await e.setPassword('tok-1'); return '' })
await step('load', async () => await e.getPassword())
await step('overwrite', async () => { await e.setPassword('tok-2-' + 'x'.repeat(4000)); return (await e.getPassword()).length + ' chars' })
await step('second instance sees it', async () => (await new AsyncEntry(SERVICE, ACCOUNT).getPassword()).slice(0, 5))
await step('different service isolated', async () => (await new AsyncEntry('co.klei.bridal.electron.spike-other', ACCOUNT).getPassword()) === null ? 'null' : 'LEAK')
await step('delete', async () => { await e.deletePassword(); return '' })
await step('load after delete -> null', async () => (await e.getPassword()) === null ? 'null' : 'NOT NULL')
await step('delete missing', async () => String(await e.deletePassword()))
for (const r of rows) console.log(r.join(' | '))
