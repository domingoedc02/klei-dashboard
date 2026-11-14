import { protocol, type Session } from 'electron'
import { serveAppFile } from './app-files.ts'
import { windowsAlias, type Serve } from './image-protocol.ts'

// Before `ready`.
export const registerAppScheme = () =>
  protocol.registerSchemesAsPrivileged([
    { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
    { scheme: 'klei-img', privileges: { standard: true, secure: true } },
  ])

export const installAppProtocol = (ses: Session, root: string) => ses.protocol.handle('app', (req) => serveAppFile(root, req))


/** macOS and Linux: `klei-img://localhost/…`. Windows: the same handler behind `http://klei-img.localhost`, and no other http request is answered. */
export function installImageProtocol(ses: Session, serve: Serve, platform: string = process.platform): void {
  ses.protocol.handle('klei-img', serve)
  if (platform === 'win32') ses.protocol.handle('http', windowsAlias(serve))
}
