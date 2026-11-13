import { protocol, type Session } from 'electron'
import { serveAppFile } from './app-files.ts'

// Before `ready`.
export const registerAppScheme = () =>
  protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }])

export const installAppProtocol = (ses: Session, root: string) => ses.protocol.handle('app', (req) => serveAppFile(root, req))
