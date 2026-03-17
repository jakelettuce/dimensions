import { cn } from '@/lib/utils'
import { useAppStore } from '@/stores/app-store'
import { Eye, Code, Maximize, Move } from 'lucide-react'

export function ToolBar() {
  const { contentView, setContentView, layoutMode, scaleMode, setScaleMode, zoom } = useAppStore()

  const handleToggleView = (view: 'live' | 'files') => {
    if (contentView === view) return
    setContentView(view)
    window.dimensions.toggleWcvVisibility(view === 'live')
  }

  const handleScaleMode = (mode: 'fit' | 'original') => {
    if (scaleMode === mode) return
    setScaleMode(mode)
    window.dimensions.setScaleMode(mode)
  }

  const zoomPercent = Math.round(zoom * 100)

  return (
    <div
      className={cn(
        'flex items-center justify-center px-[var(--space-lg)] gap-[var(--space-md)]',
        'h-[32px] shrink-0',
        'bg-[var(--color-bg-secondary)] border-b border-[var(--color-border)]',
      )}
    >
      {/* Live / Files toggle */}
      <div
        className={cn(
          'flex items-center rounded-[var(--radius-md)] overflow-hidden',
          'border border-[var(--color-border)]',
        )}
      >
        <button
          onClick={() => handleToggleView('live')}
          className={cn(
            'flex items-center gap-1 px-[var(--space-sm)] py-0.5',
            'text-[var(--text-xs)] font-medium transition-colors duration-[var(--duration-fast)]',
            contentView === 'live'
              ? 'bg-[var(--color-bg-elevated)] text-[var(--color-text-primary)]'
              : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]',
          )}
        >
          <Eye size={12} />
          Live
        </button>
        <button
          onClick={() => handleToggleView('files')}
          className={cn(
            'flex items-center gap-1 px-[var(--space-sm)] py-0.5',
            'text-[var(--text-xs)] font-medium transition-colors duration-[var(--duration-fast)]',
            contentView === 'files'
              ? 'bg-[var(--color-bg-elevated)] text-[var(--color-text-primary)]'
              : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]',
          )}
        >
          <Code size={12} />
          Files
        </button>
      </div>

      {/* Fit / Original toggle — only in Canvas mode */}
      {layoutMode === 'canvas' && (
        <div
          className={cn(
            'flex items-center rounded-[var(--radius-md)] overflow-hidden',
            'border border-[var(--color-border)]',
          )}
        >
          <button
            onClick={() => handleScaleMode('fit')}
            className={cn(
              'flex items-center gap-1 px-[var(--space-sm)] py-0.5',
              'text-[var(--text-xs)] font-medium transition-colors duration-[var(--duration-fast)]',
              scaleMode === 'fit'
                ? 'bg-[var(--color-bg-elevated)] text-[var(--color-text-primary)]'
                : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]',
            )}
          >
            <Maximize size={12} />
            Fit
          </button>
          <button
            onClick={() => handleScaleMode('original')}
            className={cn(
              'flex items-center gap-1 px-[var(--space-sm)] py-0.5',
              'text-[var(--text-xs)] font-medium transition-colors duration-[var(--duration-fast)]',
              scaleMode === 'original'
                ? 'bg-[var(--color-bg-elevated)] text-[var(--color-text-primary)]'
                : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]',
            )}
          >
            <Move size={12} />
            Original
          </button>
        </div>
      )}

      {/* Zoom indicator */}
      {zoomPercent !== 100 && (
        <span className="text-[var(--text-xs)] text-[var(--color-text-muted)]">
          {zoomPercent}%
        </span>
      )}
    </div>
  )
}
