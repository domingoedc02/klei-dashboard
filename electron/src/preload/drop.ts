// Window file drags for the Upload screen (17.2). Electron has no native drop event, so the preload reads the DOM drag events in its isolated world,
// turns dropped Files into paths with webUtils, and tells main on a private one-way channel. The page never sees the files, names or paths:
// file drags are stopped in the capture phase before any page listener runs. Main forwards only {over} and {count} back, and only while a watch is open.
export interface DropWiring {
  /** Private channel to main: `{over}` or `{paths}`. */
  send(message: { over: boolean } | { paths: string[] }): void
  /** webUtils.getPathForFile; '' when the File has no path on disk. */
  pathOf(file: File): string
}

type DragLike = Event & { dataTransfer?: { types?: readonly string[]; files?: ArrayLike<File> } | null }
const hasFiles = (e: DragLike) => Array.from(e.dataTransfer?.types ?? []).includes('Files')

export function attachDrop(target: EventTarget, { send, pathOf }: DropWiring): void {
  let depth = 0
  let over = false
  const setOver = (v: boolean) => {
    if (v !== over) send({ over: (over = v) })
  }
  const claim = (e: DragLike) => {
    e.preventDefault() // Chromium would otherwise open the dropped file in the window
    e.stopImmediatePropagation()
  }
  const on = (type: string, fn: (e: DragLike) => void) =>
    target.addEventListener(type, (e) => { if (hasFiles(e as DragLike)) fn(e as DragLike) }, true)

  on('dragenter', (e) => { claim(e); depth++; setOver(true) })
  on('dragover', claim)
  on('dragleave', (e) => { claim(e); depth = Math.max(0, depth - 1); if (depth === 0) setOver(false) })
  on('drop', (e) => {
    claim(e)
    depth = 0
    setOver(false)
    const paths = Array.from(e.dataTransfer?.files ?? [], (f) => { try { return pathOf(f) } catch { return '' } }).filter((p) => p !== '')
    if (paths.length > 0) send({ paths })
  })
}
