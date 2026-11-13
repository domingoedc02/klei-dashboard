import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { DROP_CHANNEL } from '../shared/commands.ts'
import { createBridge } from './bridge.ts'
import { attachDrop } from './drop.ts'

// Wrapped so `ipcRenderer` itself never leaves this file.
contextBridge.exposeInMainWorld(
  'klei',
  createBridge({
    invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
    on: (channel, l) => void ipcRenderer.on(channel, l),
    removeListener: (channel, l) => void ipcRenderer.removeListener(channel, l),
  }),
)

attachDrop(window, { send: (m) => ipcRenderer.send(DROP_CHANNEL, m), pathOf: (f) => webUtils.getPathForFile(f) })
