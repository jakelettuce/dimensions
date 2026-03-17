import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/stores/app-store'

let Terminal: any = null
let FitAddon: any = null

async function loadXterm() {
  if (Terminal) return
  const xtermModule = await import('@xterm/xterm')
  const fitModule = await import('@xterm/addon-fit')
  Terminal = xtermModule.Terminal
  FitAddon = fitModule.FitAddon
}

export function TerminalView() {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<any>(null)
  const fitRef = useRef<any>(null)
  const terminalIdRef = useRef<string | null>(null)
  const scenePathRef = useRef<string | null>(null)
  const { currentScene } = useAppStore()
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Create terminal once, keep alive across edit mode toggles.
  // Only recreate when scene path changes.
  useEffect(() => {
    if (!currentScene?.path) return

    let destroyed = false

    async function init() {
      await loadXterm()
      if (destroyed || !containerRef.current) return

      // If terminal already exists for this scene, just re-fit
      if (termRef.current && scenePathRef.current === currentScene!.path) {
        requestAnimationFrame(() => {
          try { fitRef.current?.fit() } catch {}
        })
        return
      }

      // Cleanup previous terminal if scene changed
      if (terminalIdRef.current) {
        window.dimensions.removeTerminalOutputListener(terminalIdRef.current)
        window.dimensions.destroyTerminal(terminalIdRef.current)
        terminalIdRef.current = null
      }
      if (termRef.current) {
        termRef.current.dispose()
        termRef.current = null
      }

      const term = new Terminal({
        fontSize: 13,
        fontFamily: "'JetBrains Mono', 'SF Mono', 'Fira Code', 'Menlo', monospace",
        theme: {
          background: '#0a0a0a',
          foreground: '#e5e5e5',
          cursor: '#7c3aed',
          cursorAccent: '#0a0a0a',
          selectionBackground: 'rgba(124, 58, 237, 0.3)',
          black: '#1e1e1e',
          red: '#ef4444',
          green: '#22c55e',
          yellow: '#eab308',
          blue: '#3b82f6',
          magenta: '#7c3aed',
          cyan: '#06b6d4',
          white: '#e5e5e5',
        },
        cursorBlink: true,
        allowTransparency: true,
        scrollback: 5000,
      })

      const fit = new FitAddon()
      term.loadAddon(fit)
      term.open(containerRef.current!)

      requestAnimationFrame(() => {
        if (!destroyed) {
          try { fit.fit() } catch {}
        }
      })

      termRef.current = term
      fitRef.current = fit
      scenePathRef.current = currentScene!.path

      // Create PTY in main process with cwd = scene path
      const result = await window.dimensions.createTerminal(currentScene!.path)

      if (typeof result === 'object' && result?.error) {
        setError(result.error)
        return
      }
      if (typeof result !== 'string') {
        setError('Failed to create terminal')
        return
      }

      if (destroyed) {
        window.dimensions.destroyTerminal(result)
        return
      }

      const id = result
      terminalIdRef.current = id

      window.dimensions.onTerminalOutput(id, (data: string) => {
        if (termRef.current) {
          termRef.current.write(data)
        }
      })

      term.onData((data: string) => {
        window.dimensions.sendTerminalInput(id, data)
      })

      term.onResize(({ cols, rows }: { cols: number; rows: number }) => {
        window.dimensions.resizeTerminal(id, cols, rows)
      })

      setTimeout(() => {
        if (!destroyed) {
          try { fit.fit() } catch {}
        }
      }, 100)

      setReady(true)
    }

    init()

    // Only cleanup on unmount or scene change — NOT on editMode toggle
    return () => {
      destroyed = true
    }
  }, [currentScene?.path])

  // Full cleanup on unmount (component removed from DOM)
  useEffect(() => {
    return () => {
      if (terminalIdRef.current) {
        window.dimensions.removeTerminalOutputListener(terminalIdRef.current)
        window.dimensions.destroyTerminal(terminalIdRef.current)
        terminalIdRef.current = null
      }
      if (termRef.current) {
        termRef.current.dispose()
        termRef.current = null
      }
      fitRef.current = null
      scenePathRef.current = null
    }
  }, [])

  // Re-fit when container becomes visible (edit mode toggle)
  useEffect(() => {
    if (!fitRef.current) return

    // Fit on next frame to pick up new container size
    const raf = requestAnimationFrame(() => {
      try { fitRef.current?.fit() } catch {}
    })

    const observer = new ResizeObserver(() => {
      try { fitRef.current?.fit() } catch {}
    })

    if (containerRef.current) {
      observer.observe(containerRef.current)
    }

    return () => {
      cancelAnimationFrame(raf)
      observer.disconnect()
    }
  }, [ready])

  // Note: when scene changes, the main effect re-runs and creates a new terminal
  // with the new scene's cwd. No separate cd needed.

  if (error) {
    return (
      <div className={cn('h-full w-full flex items-center justify-center bg-[var(--color-bg-primary)]')}>
        <p className="text-[var(--text-xs)] text-[var(--color-error)]">Terminal error: {error}</p>
      </div>
    )
  }

  return (
    <div className={cn('h-full w-full bg-[var(--color-bg-primary)]')}>
      <div ref={containerRef} className="h-full w-full" />
    </div>
  )
}
