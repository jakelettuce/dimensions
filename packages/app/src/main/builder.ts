import * as esbuild from 'esbuild'
import fs from 'fs'
import path from 'path'
import { getContextInjectionScript, getSdkBundle } from './sdk-bundle'

// Cached SDK bundle IIFE — loaded once, injected into every widget
let sdkScript: string | null = null

async function ensureSdkScript(): Promise<string> {
  if (sdkScript) return sdkScript
  const bundle = await getSdkBundle()
  sdkScript = `<script>\n${bundle}\n</script>`
  return sdkScript
}

// Build a widget from src/ to dist/bundle.html.
// Always async — never blocks the main process.
//
// Strategy:
// 1. If src/index.ts or src/index.js exists, bundle it via esbuild (IIFE, browser)
// 2. Read src/index.html
// 3. Inject context script + SDK runtime + bundled JS into HTML
// 4. Write dist/bundle.html
export async function buildWidget(widgetSrcDir: string): Promise<{ success: boolean; error?: string }> {
  const widgetDir = path.dirname(widgetSrcDir)
  const distDir = path.join(widgetDir, 'dist')

  if (!fs.existsSync(distDir)) {
    fs.mkdirSync(distDir, { recursive: true })
  }

  const htmlPath = path.join(widgetSrcDir, 'index.html')
  const tsPath = path.join(widgetSrcDir, 'index.ts')
  const jsPath = path.join(widgetSrcDir, 'index.js')
  const tsxPath = path.join(widgetSrcDir, 'index.tsx')

  const entryPoint = [tsxPath, tsPath, jsPath].find((p) => fs.existsSync(p))

  try {
    let bundledJs = ''

    if (entryPoint) {
      const result = await esbuild.build({
        entryPoints: [entryPoint],
        bundle: true,
        format: 'iife',
        platform: 'browser',
        target: 'es2022',
        sourcemap: 'inline',
        write: false,
        outdir: distDir,
        logLevel: 'warning',
      })

      if (result.outputFiles && result.outputFiles.length > 0) {
        bundledJs = result.outputFiles[0].text
      }
    }

    // Get SDK injection scripts
    const contextScript = getContextInjectionScript()
    const sdkTag = await ensureSdkScript()
    const injectionHead = `${contextScript}\n${sdkTag}`

    if (fs.existsSync(htmlPath)) {
      let html = fs.readFileSync(htmlPath, 'utf-8')

      // Inject context + SDK after <head> or at the very start
      if (html.includes('<head>')) {
        html = html.replace('<head>', `<head>\n${injectionHead}`)
      } else if (html.includes('<html>') || html.includes('<html ')) {
        html = html.replace(/<html[^>]*>/, `$&\n<head>${injectionHead}</head>`)
      } else {
        html = `${injectionHead}\n${html}`
      }

      // Inject widget JS before </body>
      if (bundledJs) {
        const scriptTag = `<script>\n${bundledJs}\n</script>`
        if (html.includes('</body>')) {
          html = html.replace('</body>', `${scriptTag}\n</body>`)
        } else {
          html += `\n${scriptTag}`
        }
      }

      fs.writeFileSync(path.join(distDir, 'bundle.html'), html, 'utf-8')
    } else if (bundledJs) {
      const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8">${injectionHead}</head>
<body><script>\n${bundledJs}\n</script></body></html>`
      fs.writeFileSync(path.join(distDir, 'bundle.html'), html, 'utf-8')
    } else {
      return { success: false, error: 'No index.html or entry script found in widget src/' }
    }

    return { success: true }
  } catch (err: any) {
    const msg = err.message || String(err)
    console.error(`Widget build failed for ${widgetSrcDir}:`, msg)
    return { success: false, error: msg }
  }
}

// Given a changed file path, resolve the widget src directory.
// Expected: .../widgets/<name>/src/<file>
export function resolveWidgetSrcDir(filePath: string): string | null {
  const parts = filePath.split(path.sep)
  const srcIdx = parts.lastIndexOf('src')
  if (srcIdx < 2) return null

  const widgetsIdx = parts.lastIndexOf('widgets')
  if (widgetsIdx < 0 || widgetsIdx >= srcIdx - 1) return null

  return parts.slice(0, srcIdx + 1).join(path.sep)
}

// Given a widget src dir, resolve the widget ID from its manifest.
export function resolveWidgetId(widgetSrcDir: string): string | null {
  const manifestPath = path.join(widgetSrcDir, 'widget.manifest.json')
  if (!fs.existsSync(manifestPath)) return null
  try {
    const raw = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))
    return raw.id ?? null
  } catch {
    return null
  }
}
