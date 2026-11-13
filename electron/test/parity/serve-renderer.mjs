// Static server for a built renderer (story 14.2). 14.4 later fills electron/build/renderer; until then pass --renderer-url or use build-renderer.mjs.
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

const MIME = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.woff2': 'font/woff2', '.woff': 'font/woff', '.map': 'application/json',
}

export function serveRenderer(dir) {
  const root = resolve(dir)
  const srv = createServer(async (req, res) => {
    try {
      const rel = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([/\\]|\.\.[/\\])+/, '')
      const file = resolve(root, rel === '' ? 'index.html' : rel)
      if (file !== root && !file.startsWith(root + sep)) throw new Error('outside')
      res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' }).end(await readFile(file))
    } catch {
      res.writeHead(404).end()
    }
  })
  return new Promise((ok) => srv.listen(0, '127.0.0.1', () => ok({ url: `http://127.0.0.1:${srv.address().port}`, close: () => srv.close() })))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const s = await serveRenderer(process.argv[2] ?? 'electron/build/renderer')
  console.log(s.url)
}
