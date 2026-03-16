import { cn } from '@/lib/utils'
import { useAppStore } from '@/stores/app-store'
import { ChevronLeft, ChevronRight } from 'lucide-react'

export function TopBar() {
  const { editMode, currentScene } = useAppStore()

  return (
    <div
      className={cn(
        'drag-region flex items-center justify-between border-b px-[var(--space-lg)]',
        'h-[var(--topbar-height)] bg-[var(--color-bg-secondary)] border-[var(--color-border)]',
        'shrink-0',
      )}
    >
      <div className="flex items-center gap-[var(--space-md)]">
        {/* Traffic light spacer on macOS */}
        <div className="w-[70px]" />

        {/* Navigation buttons */}
        <div className="flex items-center gap-[var(--space-xs)] no-drag">
          <button
            onClick={() => window.dimensions.navigateTo('dimensions://back')}
            className={cn(
              'flex items-center justify-center w-6 h-6 rounded-[var(--radius-sm)]',
              'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]',
              'hover:bg-[var(--color-bg-hover)] transition-colors duration-[var(--duration-fast)]',
            )}
          >
            <ChevronLeft size={14} />
          </button>
          <button
            onClick={() => window.dimensions.navigateTo('dimensions://forward')}
            className={cn(
              'flex items-center justify-center w-6 h-6 rounded-[var(--radius-sm)]',
              'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]',
              'hover:bg-[var(--color-bg-hover)] transition-colors duration-[var(--duration-fast)]',
            )}
          >
            <ChevronRight size={14} />
          </button>
        </div>

        {/* Scene title */}
        <h1
          className={cn(
            'text-[var(--text-sm)] font-medium no-drag cursor-default',
            'text-[var(--color-text-primary)]',
          )}
        >
          {currentScene?.title ?? 'Dimensions'}
        </h1>
      </div>

      <div className="flex items-center gap-[var(--space-sm)] no-drag">
        {/* Mode indicator */}
        <span
          className={cn(
            'rounded-[var(--radius-sm)] px-2 py-0.5',
            'text-[var(--text-xs)] font-medium transition-colors duration-[var(--duration-fast)]',
            editMode
              ? 'bg-[var(--color-accent-subtle)] text-[var(--color-accent)]'
              : 'bg-[var(--color-bg-tertiary)] text-[var(--color-text-muted)]',
          )}
        >
          {editMode ? 'Edit' : 'Use'}
        </span>
      </div>
    </div>
  )
}
