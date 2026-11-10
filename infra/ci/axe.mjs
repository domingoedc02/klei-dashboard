// axe-core on the Auth Web pages (Story 1.6). Needs the pages from AuthWebIT (`./mvnw verify`) and Chrome; run `npm ci` here first.
// Fails on any serious or critical violation. Stylesheets and fonts are read from disk, so contrast is checked as rendered.
import { readdirSync, readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import puppeteer from 'puppeteer-core'

const here = dirname(fileURLToPath(import.meta.url))
const pages = resolve(here, '../../backend/app/target/auth-pages')
const staticDir = resolve(here, '../../backend/app/src/main/resources/static')
const chrome = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const axe = readFileSync(resolve(here, 'node_modules/axe-core/axe.min.js'), 'utf8')
const work = mkdtempSync(join(tmpdir(), 'klei-axe-'))

const browser = await puppeteer.launch({ executablePath: chrome, headless: true })
let bad = 0
for (const f of readdirSync(pages).filter((n) => n.endsWith('.html'))) {
  const html = readFileSync(join(pages, f), 'utf8').replaceAll('"/static/', `"${pathToFileURL(staticDir).href}/`)
  const file = join(work, f)
  writeFileSync(file, html)
  const page = await browser.newPage()
  await page.goto(pathToFileURL(file).href)
  await page.evaluate(axe)
  const { violations } = await page.evaluate(() => axe.run(document))
  const serious = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
  console.log(`${f}: ${violations.length} violations, ${serious.length} serious or critical`)
  for (const v of violations) console.log(`  ${v.impact} ${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(' ')).join(', ')})`)
  bad += serious.length
  await page.close()
}
await browser.close()
process.exit(bad ? 1 : 0)
