import { useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/stores/app-store'
import { Search } from 'lucide-react'

export function CommandPalette() {
  const { paletteOpen, closePalette } = useAppStore()
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (paletteOpen && inputRef.current) {
      inputRef.current.focus()
    }
  }, [paletteOpen])

  // Close on Escape
  useEffect(() => {
    if (!paletteOpen) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closePalette()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [paletteOpen, closePalette])

  if (!paletteOpen) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh]"
      onClick={closePalette}
    >
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/50" />

      {/* Palette */}
      <div
        onClick={(e) => e.stopPropagation()}
        className={cn(
          'relative z-10 rounded-[var(--radius-xl)] overflow-hidden',
          'w-[var(--palette-width)] max-h-[400px]',
          'bg-[var(--color-bg-elevated)] border border-[var(--color-border)]',
          'shadow-[var(--shadow-lg)]',
        )}
      >
        {/* Search input */}
        <div className="flex items-center gap-[var(--space-md)] px-[var(--space-lg)] border-b border-[var(--color-border)]">
          <Search size={16} className="text-[var(--color-text-muted)] shrink-0" />
          <input
            ref={inputRef}
            type="text"
            placeholder="Search scenes, actions..."
            className={cn(
              'flex-1 h-12 bg-transparent border-none outline-none',
              'text-[var(--text-base)] text-[var(--color-text-primary)]',
              'placeholder:text-[var(--color-text-muted)]',
            )}
          />
        </div>

        {/* Results placeholder */}
        <div className="p-[var(--space-md)]">
          <p className="text-[var(--text-xs)] text-[var(--color-text-muted)] text-center py-[var(--space-lg)]">
            Command palette — full implementation in Phase 6
          </p>
        </div>
      </div>
    </div>
  )
}
