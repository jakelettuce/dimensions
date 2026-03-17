import { cn } from '@/lib/utils'
import { useAppStore } from '@/stores/app-store'
import { ChevronLeft, ChevronRight } from 'lucide-react'

export function TopBar() {
  const { editMode, currentScene, sceneSidebarOpen } = useAppStore()

  return (
    <div
      className={cn(
        'drag-region flex items-center justify-between border-b px-[var(--space-md)]',
        'h-[var(--topbar-height)] bg-[var(--color-bg-secondary)] border-[var(--color-border)]',
        'shrink-0',
      )}
    >
      <div className="flex items-center gap-[var(--space-sm)]">
        {/* Traffic light spacer — only when sidebar is closed (sidebar covers the buttons when open) */}
        {!sceneSidebarOpen && <div className="w-[70px]" />}

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

        {/* Breadcrumb */}
        <h1
          className={cn(
            'text-[var(--text-sm)] font-medium no-drag cursor-default',
            'text-[var(--color-text-primary)] flex items-center gap-[var(--space-xs)]',
          )}
        >
          {currentScene?.dimensionTitle && (
            <>
              <span className="text-[var(--color-text-muted)]">
                {currentScene.dimensionTitle}
              </span>
              <span className="text-[var(--color-text-muted)]">&gt;</span>
            </>
          )}
          {currentScene?.title ?? 'Dimensions'}
        </h1>
      </div>

      <div className="flex items-center gap-[var(--space-sm)] no-drag">
        {/* Edit/Use mode toggle */}
        <button
          onClick={() => window.dimensions.toggleEditMode()}
          className={cn(
            'relative flex items-center w-[72px] h-[26px] rounded-full p-[2px] no-drag',
            'transition-colors duration-300 ease-in-out cursor-pointer',
            editMode
              ? 'bg-[var(--color-accent)]'
              : 'bg-[var(--color-bg-tertiary)]',
          )}
        >
          <span
            className={cn(
              'absolute top-[2px] h-[22px] w-[34px] rounded-full shadow-sm',
              'transition-all duration-300 ease-in-out',
              editMode
                ? 'left-[36px] bg-white'
                : 'left-[2px] bg-[var(--color-text-primary)]',
            )}
          />
          <span
            className={cn(
              'relative z-10 flex-1 text-center text-[10px] font-semibold leading-[22px]',
              'transition-colors duration-300',
              !editMode ? 'text-[var(--color-bg-primary)]' : 'text-white/70',
            )}
          >
            Use
          </span>
          <span
            className={cn(
              'relative z-10 flex-1 text-center text-[10px] font-semibold leading-[22px]',
              'transition-colors duration-300',
              editMode ? 'text-[var(--color-accent)]' : 'text-[var(--color-text-muted)]',
            )}
          >
            Edit
          </span>
        </button>
      </div>
    </div>
  )
}
