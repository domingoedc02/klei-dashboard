// Test fixture: the same browser calls the original renderer makes, line for line, so the shell can be checked without a signed-in session.
// Composer.tsx:237 paste, Assistant.tsx:85 copy, Review.tsx:109-116 beforeunload.
window.addEventListener('DOMContentLoaded', () => {
  const box = document.getElementById('box')
  const status = document.getElementById('status')
  box.addEventListener('paste', (e) => {
    e.preventDefault()
    document.execCommand?.('insertText', false, e.clipboardData.getData('text/plain'))
  })
  document.getElementById('copy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(window.toCopy); status.textContent = 'Copied' } catch { status.textContent = "Couldn't copy. Select the text instead." }
  })
})
const unload = (e) => { e.preventDefault(); e.returnValue = '' }
window.dirty = (on) => (on ? window.addEventListener('beforeunload', unload) : window.removeEventListener('beforeunload', unload))
window.marker = Math.random()
window.hashes = []
window.addEventListener('hashchange', () => window.hashes.push(location.hash))
window.show = (s) => { document.getElementById('shown').textContent = s }

// Persistence audit: put the sentinel everywhere a page can store something.
window.storeEverywhere = async (s) => {
  const done = []
  const tryIt = async (name, f) => { try { await f(); done.push(name) } catch (e) { done.push(`${name}:${e.name}`) } }
  await tryIt('local', () => localStorage.setItem('k', s))
  await tryIt('session', () => sessionStorage.setItem('k', s))
  await tryIt('cookie', () => { document.cookie = `k=${s}; max-age=99999` })
  await tryIt('cache', async () => (await caches.open('k')).put('https://example.invalid/k', new Response(s)))
  await tryIt('idb', () => new Promise((ok, no) => {
    const r = indexedDB.open('k', 1)
    r.onupgradeneeded = () => r.result.createObjectStore('s')
    r.onsuccess = () => { const t = r.result.transaction('s', 'readwrite'); t.objectStore('s').put(s, 'k'); t.oncomplete = () => { r.result.close(); ok() }; t.onerror = () => no(t.error) }
    r.onerror = () => no(r.error)
  }))
  document.title = s
  document.getElementById('shown').textContent = s
  return done
}
