import { app } from 'electron'
app.setPath('userData', process.env.UD)
app.setName(process.env.NAME)
const got = app.requestSingleInstanceLock()
console.log(process.env.TAG, 'lock', got)
app.whenReady().then(() => setTimeout(() => app.quit(), 4000))
