import { cn } from '@/lib/utils'
import { useAppStore } from '@/stores/app-store'
import { Eye, Code } from 'lucide-react'

export function ToolBar() {
  const { contentView, setContentView } = useAppStore()

  const handleToggleView = (view: 'live' | 'files') => {
    if (contentView === view) return
    setContentView(view)
    window.dimensions.toggleWcvVisibility(view === 'live')
  }

  return (
    <div
      className={cn(
        'flex items-center justify-center px-[var(--space-lg)] gap-[var(--space-sm)]',
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
    </div>
  )
}
