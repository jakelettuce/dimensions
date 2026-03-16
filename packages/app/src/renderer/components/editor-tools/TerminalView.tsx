import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/stores/app-store'

// xterm.js imports — loaded dynamically to avoid SSR issues
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

  useEffect(() => {
    if (!editMode || !currentScene?.path) return

    let destroyed = false

    async function init() {
      await loadXterm()
      if (destroyed || !containerRef.current) return

      // Create xterm.js instance
      const term = new Terminal({
        fontSize: 13,
        fontFamily: 'var(--font-mono)',
        theme: {
          background: '#0a0a0a',
          foreground: '#e5e5e5',
          cursor: '#7c3aed',
          selectionBackground: 'rgba(124, 58, 237, 0.3)',
        },
        cursorBlink: true,
        allowTransparency: true,
      })

      const fit = new FitAddon()
      term.loadAddon(fit)
      term.open(containerRef.current!)
      fit.fit()

      termRef.current = term
      fitRef.current = fit

      // Create PTY in main process
      const id = await window.dimensions.createTerminal(currentScene!.path)
      if (destroyed) {
        window.dimensions.destroyTerminal(id)
        return
      }
      terminalIdRef.current = id

      // Wire output: PTY → xterm
      window.dimensions.onTerminalOutput(id, (data: string) => {
        term.write(data)
      })

      // Wire input: xterm → PTY
      term.onData((data: string) => {
        window.dimensions.sendTerminalInput(id, data)
      })

      // Handle resize
      term.onResize(({ cols, rows }: { cols: number; rows: number }) => {
        window.dimensions.resizeTerminal(id, cols, rows)
      })

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
      setReady(false)
    }
  }, [editMode, currentScene?.path])

  // Resize on container size changes
  useEffect(() => {
    if (!fitRef.current || !ready) return

    const observer = new ResizeObserver(() => {
      try {
        fitRef.current?.fit()
      } catch {}
    })

    if (containerRef.current) {
      observer.observe(containerRef.current)
    }

    return () => observer.disconnect()
  }, [ready])

  return (
    <div className={cn('h-full w-full bg-[var(--color-bg-primary)]')}>
      <div ref={containerRef} className="h-full w-full p-[var(--space-xs)]" />
    </div>
  )
}
