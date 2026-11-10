// Fake Tauri IPC for plain Chromium. The page side only forwards `invoke(cmd,args)` to Node (`__fx`), where fixtures decide the answer.
// Handler result: a value, a never-settling promise (loading state), `{ __reject }` (BridgeError), or `{ __events, value }` (Channel commands).

export async function installShim(page, handler, log) {
  await page.exposeFunction('__fx', async (cmd, args) => {
    try {
      return { ok: await handler(cmd, args) };
    } catch (e) {
      log(`handler threw for ${cmd}: ${e}`);
      return { err: { kind: 'failed', message: String(e) } };
    }
  });
  await page.addInitScript(() => {
    const cbs = new Map();
    let n = 0;
    window.__TAURI_INTERNALS__ = {
      transformCallback(cb) { const id = ++n; cbs.set(id, cb); return id; },
      unregisterCallback(id) { cbs.delete(id); },
      async invoke(cmd, args) {
        const r = await window.__fx(cmd, JSON.parse(JSON.stringify(args ?? {})));
        if (r.err) throw r.err;
        const v = r.ok;
        if (v && v.__reject) throw v.__reject;
        if (v && v.__events) {
          const m = /^__CHANNEL__:(\d+)$/.exec(args?.onEvent ?? '');
          const cb = m && cbs.get(Number(m[1]));
          if (cb) {
            v.__events.forEach((message, index) => cb({ index, message }));
            cb({ end: true, index: v.__events.length });
          }
          return v.value;
        }
        return v;
      },
    };
  });
}
