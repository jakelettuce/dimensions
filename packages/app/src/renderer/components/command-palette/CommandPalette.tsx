import { useEffect, useRef, useCallback } from 'react'
import { useAppStore } from '@/stores/app-store'
import { cn } from '@/lib/utils'
import { Search } from 'lucide-react'

export function CommandPalette() {
  const { paletteOpen, closePalette } = useAppStore()
  const inputRef = useRef<HTMLInputElement>(null)

  const handleClose = useCallback(() => {
    closePalette()
    window.dimensions.paletteClose()
  }, [closePalette])

  useEffect(() => {
    if (paletteOpen && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [paletteOpen])

  useEffect(() => {
    if (!paletteOpen) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [paletteOpen, handleClose])

  if (!paletteOpen) return null

  return (
    <div
      className={cn(
        'fixed inset-0 z-50 flex items-start justify-center',
        'pt-[15vh]',
      )}
      onClick={handleClose}
    >
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/60" />

      {/* Palette card */}
      <div
        onClick={(e) => e.stopPropagation()}
        className={cn(
          'relative z-10 w-[560px] max-h-[400px] overflow-hidden',
          'rounded-[var(--radius-xl)]',
          'bg-[var(--color-bg-elevated)] border border-[var(--color-border)]',
          'shadow-[var(--shadow-lg)]',
        )}
      >
        {/* Search input */}
        <div
          className={cn(
            'flex items-center gap-[var(--space-md)] px-[var(--space-lg)]',
            'border-b border-[var(--color-border)]',
          )}
        >
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

        {/* Results — full implementation in Phase 6 */}
        <div className="p-[var(--space-lg)]">
          <p className="text-[var(--text-xs)] text-[var(--color-text-muted)] text-center py-[var(--space-xl)]">
            Type to search scenes and actions...
          </p>
        </div>
      </div>
    </div>
  )
}
