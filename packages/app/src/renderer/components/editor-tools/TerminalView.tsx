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
  const { currentScene, editMode } = useAppStore()
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!editMode || !currentScene?.path) return

    let destroyed = false

    async function init() {
      await loadXterm()
      if (destroyed || !containerRef.current) return

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

      // Small delay to ensure container has dimensions before fitting
      requestAnimationFrame(() => {
        if (!destroyed) {
          try { fit.fit() } catch {}
        }
      })

      termRef.current = term
      fitRef.current = fit

      // Create PTY in main process
      const result = await window.dimensions.createTerminal(currentScene!.path)

      // Check if result is an error object or a terminal ID string
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

      // Wire output: PTY → xterm
      window.dimensions.onTerminalOutput(id, (data: string) => {
        if (termRef.current) {
          termRef.current.write(data)
        }
      })

      // Wire input: xterm → PTY
      term.onData((data: string) => {
        window.dimensions.sendTerminalInput(id, data)
      })

      // Handle resize
      term.onResize(({ cols, rows }: { cols: number; rows: number }) => {
        window.dimensions.resizeTerminal(id, cols, rows)
      })

      // Fit after a beat to get proper dimensions
      setTimeout(() => {
        if (!destroyed) {
          try { fit.fit() } catch {}
        }
      }, 100)

      setReady(true)
    }

    init()

    return () => {
      destroyed = true
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
      setReady(false)
      setError(null)
    }
  }, [editMode, currentScene?.path])

  // Resize on container size changes
  useEffect(() => {
    if (!fitRef.current || !ready) return

    const observer = new ResizeObserver(() => {
      try { fitRef.current?.fit() } catch {}
    })

    if (containerRef.current) {
      observer.observe(containerRef.current)
    }

    return () => observer.disconnect()
  }, [ready])

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
