import { contextBridge, ipcRenderer } from 'electron'
import { createBridge } from './bridge.ts'

// Wrapped so `ipcRenderer` itself never leaves this file.
contextBridge.exposeInMainWorld(
  'klei',
  createBridge({
    invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
    on: (channel, l) => void ipcRenderer.on(channel, l),
    removeListener: (channel, l) => void ipcRenderer.removeListener(channel, l),
  }),
)
