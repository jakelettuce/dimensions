import * as pty from 'node-pty'
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

// ── Helpers ──

function getShell(): string {
  if (process.platform === 'win32') return 'powershell.exe'

  // Try SHELL env var first, then common paths
  const candidates = [
    process.env.SHELL,
    '/bin/zsh',
    '/bin/bash',
    '/bin/sh',
  ].filter(Boolean) as string[]

  const fs = require('fs')
  for (const shell of candidates) {
    try {
      if (fs.existsSync(shell)) return shell
    } catch {}
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
  // Security: cwd must be within ~/Dimensions/
  assertPathWithin(cwd, DIMENSIONS_DIR)

  const id = generateTerminalId()
  const shell = getShell()

  // Use --login to load user's shell configs (.zshrc, .bash_profile, etc.)
  const args = shell.endsWith('zsh') || shell.endsWith('bash') ? ['--login'] : []

  const ptyProcess = pty.spawn(shell, args, {
    name: 'xterm-256color',
    cols,
    rows,
    cwd,
    env: {
      ...process.env,
      // Ensure common env vars are set
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      HOME: process.env.HOME || '',
      LANG: process.env.LANG || 'en_US.UTF-8',
    } as Record<string, string>,
  })

  // Forward PTY output to the renderer
  ptyProcess.onData((data: string) => {
    if (!webContents.isDestroyed()) {
      webContents.send(`terminal-output:${id}`, data)
    }
  })

  // Clean up on unexpected PTY exit
  ptyProcess.onExit(() => {
    terminals.delete(id)
  })

  terminals.set(id, { id, pty: ptyProcess, windowId })
  return id
}

function destroyTerminal(id: string): void {
  const managed = terminals.get(id)
  if (!managed) return

  try {
    managed.pty.kill()
  } catch {
    // PTY may already be dead
  }
  terminals.delete(id)
}

/**
 * Destroy all terminals associated with a given window.
 * Called on scene change or window close.
 */
export function destroyTerminalsForWindow(windowId: string): void {
  for (const [id, managed] of terminals) {
    if (managed.windowId === windowId) {
      try {
        managed.pty.kill()
      } catch {
        // PTY may already be dead
      }
      terminals.delete(id)
    }
  }
}

/**
 * Destroy every managed terminal. Called on app quit.
 */
function destroyAllTerminals(): void {
  for (const [id, managed] of terminals) {
    try {
      managed.pty.kill()
    } catch {
      // PTY may already be dead
    }
    terminals.delete(id)
  }
}

// ── IPC Registration ──

export function registerTerminalIpcHandlers(): void {
  // create-terminal: spawns a new PTY, returns terminal ID
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

  // terminal-input: fire-and-forget data into the PTY stdin
  ipcMain.on('terminal-input', (_event, id: unknown, data: unknown) => {
    if (typeof id !== 'string' || typeof data !== 'string') return
    const managed = terminals.get(id)
    if (managed) {
      managed.pty.write(data)
    }
  })

  // terminal-resize: resize the PTY grid
  ipcMain.on('terminal-resize', (_event, id: unknown, cols: unknown, rows: unknown) => {
    if (typeof id !== 'string' || typeof cols !== 'number' || typeof rows !== 'number') return
    const managed = terminals.get(id)
    if (managed) {
      managed.pty.resize(cols, rows)
    }
  })

  // destroy-terminal: tear down a single PTY
  ipcMain.handle('destroy-terminal', (_event, id: unknown) => {
    if (typeof id !== 'string') return
    destroyTerminal(id)
  })

  // Cleanup all terminals on app quit
  process.on('exit', destroyAllTerminals)
}
