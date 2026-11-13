// Throwaway spike preload: nine named methods, no generic dispatch.
// Errors: main answers {ok}|{err}, preload rethrows a plain {kind,message}.
// Channel: main sends {index,message}... then {end:true,index}; preload delivers in index order and resolves only after the end marker AND the reply.
const { contextBridge, ipcRenderer } = require('electron')
const unwrap = (r) => { if (r && r.err) throw r.err; return r.ok }
const call = (name) => async (...a) => unwrap(await ipcRenderer.invoke('klei:' + name, ...a))
const withEvents = (name) => async (kind, x, onEvent) => {
  const id = Math.random().toString(36).slice(2)
  let next = 0, endAt = -1, done
  const pending = new Map()
  const finished = new Promise((r) => (done = r))
  const pump = () => {
    while (pending.has(next)) { const m = pending.get(next); pending.delete(next); next++; try { onEvent(m) } catch {} }
    if (endAt === next) done()
  }
  const h = (_e, raw) => { if (raw.end) endAt = raw.index; else pending.set(raw.index, raw.message); pump() }
  ipcRenderer.on('klei:ev:' + id, h)
  try {
    const r = await ipcRenderer.invoke('klei:' + name, kind, x, id)
    await finished
    return unwrap(r)
  } finally { ipcRenderer.removeListener('klei:ev:' + id, h) }
}
contextBridge.exposeInMainWorld('klei', {
  api_request: call('api_request'), sign_in: call('sign_in'), sign_out: call('sign_out'), session_only: call('session_only'),
  set_dirty: call('set_dirty'), check_update: call('check_update'), install_update: call('install_update'),
  upload_files: withEvents('upload_files'), export_gowns: withEvents('export_gowns'),
})
