/**
 * After a deploy, a tab still running the previous build asks for chunk files that no longer exist (404).
 * Vite reports that as `vite:preloadError`; reload once to pick up the new build. The session flag stops a
 * reload loop if the chunk is genuinely missing.
 */
const FLAG = 'bm-stale-build-reload'

export function reloadOnStaleBuild(win: Window = window): void {
  win.addEventListener('vite:preloadError', (event) => {
    if (win.sessionStorage.getItem(FLAG)) return
    win.sessionStorage.setItem(FLAG, '1')
    event.preventDefault()
    win.location.reload()
  })
  win.addEventListener('load', () => win.setTimeout(() => win.sessionStorage.removeItem(FLAG), 10_000))
}
