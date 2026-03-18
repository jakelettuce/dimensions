import { ipcMain } from 'electron'
import fs from 'fs'
import path from 'path'
import { DIMENSIONS_DIR } from './constants'
import { assertPathWithin } from './ipc-safety'
import { findWindowByWebContentsId } from './window-manager'
import { buildWidget, resolveWidgetSrcDir, resolveWidgetId } from './builder'
import { writeAgentContextFiles } from './agent-context'
import { loadSceneFromDisk, createScene, createDimension } from './scene-manager'
import { sanitizeIpcData } from './ipc-safety'

const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB

export function registerFileOperationHandlers(): void {
  // ── list-scenes (scan ~/Dimensions/ for all scenes — standalone + inside dimensions) ──
  ipcMain.handle('list-scenes', () => {
    try {
      if (!fs.existsSync(DIMENSIONS_DIR)) return []
      const entries = fs.readdirSync(DIMENSIONS_DIR, { withFileTypes: true })
      const scenes: Array<{ id: string; slug: string; title: string; path: string; dimensionTitle?: string }> = []

      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        if (entry.name.startsWith('.')) continue
        const entryPath = path.join(DIMENSIONS_DIR, entry.name)

        // Standalone scene (has meta.json, no dimension.json)
        const metaPath = path.join(entryPath, 'meta.json')
        if (fs.existsSync(metaPath) && !fs.existsSync(path.join(entryPath, 'dimension.json'))) {
          try {
            const raw = JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
            scenes.push({
              id: raw.id || entry.name,
              slug: raw.slug || entry.name,
              title: raw.title || entry.name,
              path: entryPath,
            })
          } catch {}
        }

        // Dimension folder — scan for scenes inside
        const dimJsonPath = path.join(entryPath, 'dimension.json')
        if (fs.existsSync(dimJsonPath)) {
          try {
            const dimRaw = JSON.parse(fs.readFileSync(dimJsonPath, 'utf-8'))
            const dimTitle = dimRaw.title || entry.name
            const dimScenes: string[] = dimRaw.scenes || []

            for (const sceneSlug of dimScenes) {
              const scenePath = path.join(entryPath, sceneSlug)
              const sceneMetaPath = path.join(scenePath, 'meta.json')
              if (!fs.existsSync(sceneMetaPath)) continue
              try {
                const sceneRaw = JSON.parse(fs.readFileSync(sceneMetaPath, 'utf-8'))
                scenes.push({
                  id: sceneRaw.id || sceneSlug,
                  slug: sceneRaw.slug || sceneSlug,
                  title: sceneRaw.title || sceneSlug,
                  path: scenePath,
                  dimensionTitle: dimTitle,
                })
              } catch {}
            }
          } catch {}
        }
      }

      return scenes
    } catch {
      return []
    }
  })

  // ── list-dimensions (scan for folders with dimension.json) ──
  ipcMain.handle('list-dimensions', () => {
    try {
      if (!fs.existsSync(DIMENSIONS_DIR)) return []
      const entries = fs.readdirSync(DIMENSIONS_DIR, { withFileTypes: true })
      const dimensions: Array<{ id: string; title: string; scenes: string[] }> = []

      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        if (entry.name.startsWith('.')) continue
        const dimPath = path.join(DIMENSIONS_DIR, entry.name, 'dimension.json')
        if (!fs.existsSync(dimPath)) continue
        try {
          const raw = JSON.parse(fs.readFileSync(dimPath, 'utf-8'))
          dimensions.push({
            id: raw.id || entry.name,
            title: raw.title || entry.name,
            scenes: raw.scenes || [],
          })
        } catch {}
      }

      return dimensions
    } catch {
      return []
    }
  })

  // ── read-dir ──
  ipcMain.handle('read-dir', (_event, dirPath: unknown) => {
    try {
      if (typeof dirPath !== 'string') {
        return { error: 'dirPath must be a string' }
      }

      const resolved = path.resolve(dirPath)
      assertPathWithin(resolved, DIMENSIONS_DIR)

      const entries = fs.readdirSync(resolved, { withFileTypes: true })
      return entries.map((entry) => ({
        name: entry.name,
        isDirectory: entry.isDirectory(),
        size: entry.isDirectory()
          ? 0
          : fs.statSync(path.join(resolved, entry.name)).size,
      }))
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  })

  // ── read-file ──
  ipcMain.handle('read-file', (_event, filePath: unknown) => {
    try {
      if (typeof filePath !== 'string') {
        return { error: 'filePath must be a string' }
      }

      const resolved = path.resolve(filePath)
      assertPathWithin(resolved, DIMENSIONS_DIR)

      const stat = fs.statSync(resolved)
      if (stat.size > MAX_FILE_SIZE) {
        return { error: `File exceeds 10MB limit (${stat.size} bytes)` }
      }

      return fs.readFileSync(resolved, 'utf-8')
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  })

  // ── write-file ──
  ipcMain.handle('write-file', (event, filePath: unknown, content: unknown) => {
    try {
      if (typeof filePath !== 'string') {
        return { error: 'filePath must be a string' }
      }
      if (typeof content !== 'string') {
        return { error: 'content must be a string' }
      }
      if (content.length > MAX_FILE_SIZE) {
        return { error: `Content exceeds 10MB limit (${content.length} bytes)` }
      }

      const resolved = path.resolve(filePath)
      assertPathWithin(resolved, DIMENSIONS_DIR)

      // Validate path is within the active scene folder for the requesting window
      const dimWin = findWindowByWebContentsId(event.sender.id)
      if (!dimWin) {
        return { error: 'No window found for this request' }
      }
      if (!dimWin.currentScene) {
        return { error: 'No active scene in this window' }
      }

      assertPathWithin(resolved, dimWin.currentScene.path)

      // Ensure parent directory exists
      const dir = path.dirname(resolved)
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }

      fs.writeFileSync(resolved, content, 'utf-8')

      // Explicitly trigger widget build if the file is in a widget src/ directory
      // Don't rely on chokidar — direct builds are more reliable for editor saves
      const widgetSrcDir = resolveWidgetSrcDir(resolved)
      if (widgetSrcDir) {
        buildWidget(widgetSrcDir).then((result) => {
          const widgetTypeId = resolveWidgetId(widgetSrcDir)
          if (widgetTypeId && dimWin.currentScene && !dimWin.browserWindow.isDestroyed()) {
            // Reload all instances of this widget type
            for (const entry of dimWin.currentScene.meta.widgets) {
              if (entry.widgetType === widgetTypeId) {
                dimWin.sceneWCV.webContents.send('scene:widget-reload', entry.id)
              }
            }
            // Update scene state and CLAUDE.md
            const scenePath = dimWin.currentScene.path
            const dimensionId = dimWin.currentScene.dimensionId
            const dimensionPath = dimWin.currentScene.dimensionPath
            dimWin.currentScene = loadSceneFromDisk(scenePath, dimensionId, dimensionPath)
            writeAgentContextFiles(dimWin.currentScene)

            // Notify renderer of build status
            dimWin.browserWindow.webContents.send('widget:build-status', sanitizeIpcData({
              widgetId: widgetTypeId,
              success: result.success,
              error: result.error,
            }))
          }
        }).catch(() => {})
      }

      return { success: true }
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  })

  // ── create-scene ──
  ipcMain.handle('create-scene', (_event, title: unknown, dimensionPath?: unknown) => {
    if (typeof title !== 'string' || !title.trim()) return { error: 'invalid_title' }
    const parent = typeof dimensionPath === 'string' ? dimensionPath : undefined
    if (parent) assertPathWithin(parent, DIMENSIONS_DIR)
    try {
      const scenePath = createScene(title.trim(), parent)
      // If inside a dimension, add to dimension.json scenes array
      if (parent) {
        const dimJsonPath = path.join(parent, 'dimension.json')
        if (fs.existsSync(dimJsonPath)) {
          const raw = JSON.parse(fs.readFileSync(dimJsonPath, 'utf-8'))
          const slug = path.basename(scenePath)
          if (!raw.scenes.includes(slug)) {
            raw.scenes.push(slug)
            fs.writeFileSync(dimJsonPath, JSON.stringify(raw, null, 2), 'utf-8')
          }
        }
      }
      return { scenePath }
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  })

  // ── create-dimension ──
  ipcMain.handle('create-dimension', (_event, title: unknown) => {
    if (typeof title !== 'string' || !title.trim()) return { error: 'invalid_title' }
    try {
      const result = createDimension(title.trim())
      return result
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  })
}
