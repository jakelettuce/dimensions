import * as pty from 'node-pty'
import fs from 'fs'
import { ipcMain, type BrowserWindow } from 'electron'
import { DIMENSIONS_DIR } from './constants'
import { assertPathWithin } from './ipc-safety'
import { findWindowByWebContentsId } from './window-manager'

// ── Types ──

interface ManagedTerminal {
  id: string
  pty: pty.IPty
  windowId: string
}

// ── State ──

const terminals = new Map<string, ManagedTerminal>()
let terminalCounter = 0

// ── Shell detection (Fix 1: always return absolute path) ──

function getDefaultShell(): string {
  if (process.platform === 'win32') {
    return process.env.COMSPEC || 'C:\\Windows\\System32\\cmd.exe'
  }

  // Try SHELL env var first (set by login shell)
  const envShell = process.env.SHELL
  if (envShell && fs.existsSync(envShell)) return envShell

  // Fallback: check common absolute paths
  for (const shell of ['/bin/zsh', '/bin/bash', '/bin/sh']) {
    if (fs.existsSync(shell)) return shell
  }

  return '/bin/sh'
}

function generateTerminalId(): string {
  return `terminal-${++terminalCounter}-${Date.now()}`
}

// ── Core API ──

function createTerminal(
  cwd: string,
  windowId: string,
  webContents: Electron.WebContents,
  cols = 80,
  rows = 24,
): string {
  assertPathWithin(cwd, DIMENSIONS_DIR)

  const id = generateTerminalId()
  const shell = getDefaultShell()

  // Fix 6: --login flag for shell initialization (~/.zprofile, ~/.zshrc, etc.)
  const args = process.platform === 'win32' ? [] : ['--login']

  // Fix 3: pass full process.env (after fix-path has patched PATH)
  const ptyProcess = pty.spawn(shell, args, {
    name: 'xterm-256color',
    cols,
    rows,
    cwd,
    env: { ...process.env } as Record<string, string>,
  })

  ptyProcess.onData((data: string) => {
    if (!webContents.isDestroyed()) {
      webContents.send(`terminal-output:${id}`, data)
    }
  })

  ptyProcess.onExit(() => {
    terminals.delete(id)
  })

  terminals.set(id, { id, pty: ptyProcess, windowId })
  return id
}

function destroyTerminal(id: string): void {
  const managed = terminals.get(id)
  if (!managed) return
  try { managed.pty.kill() } catch {}
  terminals.delete(id)
}

export function destroyTerminalsForWindow(windowId: string): void {
  for (const [id, managed] of terminals) {
    if (managed.windowId === windowId) {
      try { managed.pty.kill() } catch {}
      terminals.delete(id)
    }
  }
}

function destroyAllTerminals(): void {
  for (const [, managed] of terminals) {
    try { managed.pty.kill() } catch {}
  }
  terminals.clear()
}

// ── IPC Registration ──

export function registerTerminalIpcHandlers(): void {
  ipcMain.handle('create-terminal', (event, cwd: unknown) => {
    if (typeof cwd !== 'string') return { error: 'invalid_cwd' }
    const dimWin = findWindowByWebContentsId(event.sender.id)
    if (!dimWin) return { error: 'window_not_found' }

    try {
      const id = createTerminal(cwd, dimWin.id, event.sender)
      return id
    } catch (err: any) {
      return { error: err.message || 'terminal_create_failed' }
    }
  })

  ipcMain.on('terminal-input', (_event, id: unknown, data: unknown) => {
    if (typeof id !== 'string' || typeof data !== 'string') return
    const managed = terminals.get(id)
    if (managed) managed.pty.write(data)
  })

  ipcMain.on('terminal-resize', (_event, id: unknown, cols: unknown, rows: unknown) => {
    if (typeof id !== 'string' || typeof cols !== 'number' || typeof rows !== 'number') return
    const managed = terminals.get(id)
    if (managed) managed.pty.resize(cols, rows)
  })

  ipcMain.handle('destroy-terminal', (_event, id: unknown) => {
    if (typeof id !== 'string') return
    destroyTerminal(id)
  })

  process.on('exit', destroyAllTerminals)
}
