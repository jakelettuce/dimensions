import fs from 'fs'
import path from 'path'

const MAX_CSS_SIZE = 200 * 1024 // 200KB per stylesheet
const MAX_STYLESHEETS = 10

// Extract stylesheet URLs from a loaded page via executeJavaScript
export async function extractStylesheetUrls(webContents: Electron.WebContents): Promise<string[]> {
  try {
    const urls: string[] = await webContents.executeJavaScript(`
      Array.from(document.querySelectorAll('link[rel="stylesheet"]'))
        .map(link => link.href)
        .filter(href => href && href.startsWith('http'))
        .slice(0, ${MAX_STYLESHEETS})
    `)
    return urls
  } catch {
    return []
  }
}

// Fetch CSS via Node.js fetch (clean session, no cookies from the WCV)
async function fetchCss(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Dimensions/1.0' },
    })
    if (!response.ok) return null
    const text = await response.text()
    if (text.length > MAX_CSS_SIZE) return text.slice(0, MAX_CSS_SIZE)
    return text
  } catch {
    return null
  }
}

// Sanitize CSS: strip non-font url() calls, strip @import, cap size
function sanitizeCss(css: string): string {
  // Strip @import rules (could load external resources)
  let sanitized = css.replace(/@import\s+[^;]+;/gi, '')

  // Strip url() calls that aren't fonts (keep font urls)
  sanitized = sanitized.replace(/url\s*\(\s*(['"]?)([^)]+)\1\s*\)/gi, (match, _quote, urlValue) => {
    const lower = urlValue.toLowerCase()
    // Keep font URLs
    if (lower.endsWith('.woff2') || lower.endsWith('.woff') || lower.endsWith('.ttf') ||
        lower.endsWith('.otf') || lower.endsWith('.eot') ||
        lower.includes('fonts.googleapis.com') || lower.includes('fonts.gstatic.com')) {
      return match
    }
    // Strip everything else
    return 'url()'
  })

  return sanitized.slice(0, MAX_CSS_SIZE)
}

// Extract and save stylesheets from a portal page for Claude Code context
export async function extractAndSaveStylesheets(
  webContents: Electron.WebContents,
  widgetDir: string,
  hostname: string,
): Promise<string[]> {
  const urls = await extractStylesheetUrls(webContents)
  if (urls.length === 0) return []

  const stylesDir = path.join(widgetDir, 'site-styles')
  if (!fs.existsSync(stylesDir)) {
    fs.mkdirSync(stylesDir, { recursive: true })
  }

  const savedFiles: string[] = []

  for (let i = 0; i < urls.length; i++) {
    const css = await fetchCss(urls[i])
    if (!css) continue

    const sanitized = sanitizeCss(css)
    const filename = `${hostname}${i > 0 ? `-${i}` : ''}.css`
    const filePath = path.join(stylesDir, filename)
    fs.writeFileSync(filePath, sanitized, 'utf-8')
    savedFiles.push(filePath)
  }

  return savedFiles
}

// Read portal-rules.json and apply CSS injection rules via insertCSS
export async function applyPortalRules(
  webContents: Electron.WebContents,
  widgetDir: string,
  hostname: string,
): Promise<void> {
  const rulesPath = path.join(widgetDir, 'portal-rules.json')
  if (!fs.existsSync(rulesPath)) return

  try {
    const raw = JSON.parse(fs.readFileSync(rulesPath, 'utf-8'))
    const rules = Array.isArray(raw) ? raw : []

    for (const rule of rules) {
      if (!rule.enabled) continue
      if (rule.domain !== hostname && rule.domain !== '*') continue
      if (typeof rule.css !== 'string' || rule.css.length === 0) continue

      await webContents.insertCSS(rule.css)
    }
  } catch (err) {
    console.error(`Failed to apply portal rules from ${rulesPath}:`, err)
  }
}
