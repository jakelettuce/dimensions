import { ipcMain } from 'electron'
import fs from 'fs'
import path from 'path'
import { DIMENSIONS_DIR } from './constants'
import { assertPathWithin } from './ipc-safety'
import { findWindowByWebContentsId } from './window-manager'

const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB

export function registerFileOperationHandlers(): void {
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
      return { success: true }
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  })
}
