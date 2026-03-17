import { cn } from '@/lib/utils'
import { useAppStore } from '@/stores/app-store'
import { Terminal as TerminalIcon, Settings2 } from 'lucide-react'
import { TerminalView } from './TerminalView'
import { NoCodePanel } from './NoCodePanel'

export function EditorToolsPanel() {
  const { editorTool, setEditorTool } = useAppStore()

  return (
    <div
      className={cn(
        'flex flex-col border-l h-full w-full',
        'bg-[var(--color-bg-secondary)] border-[var(--color-border)]',
      )}
    >
      {/* Tool tabs */}
      <div
        className={cn(
          'flex items-center border-b px-[var(--space-sm)] gap-[var(--space-xs)]',
          'h-9 bg-[var(--color-bg-secondary)] border-[var(--color-border)]',
        )}
      >
        <button
          onClick={() => setEditorTool('claude')}
          className={cn(
            'flex items-center gap-[var(--space-xs)] px-[var(--space-sm)] py-1 rounded-[var(--radius-sm)]',
            'text-[var(--text-xs)] font-medium transition-colors duration-[var(--duration-fast)]',
            editorTool === 'claude'
              ? 'bg-[var(--color-bg-elevated)] text-[var(--color-text-primary)]'
              : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]',
          )}
        >
          <TerminalIcon size={12} />
          Terminal
        </button>
        <button
          onClick={() => setEditorTool('nocode')}
          className={cn(
            'flex items-center gap-[var(--space-xs)] px-[var(--space-sm)] py-1 rounded-[var(--radius-sm)]',
            'text-[var(--text-xs)] font-medium transition-colors duration-[var(--duration-fast)]',
            editorTool === 'nocode'
              ? 'bg-[var(--color-bg-elevated)] text-[var(--color-text-primary)]'
              : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]',
          )}
        >
          <Settings2 size={12} />
          Properties
        </button>
      </div>

      {/* Tool content */}
      <div className="flex-1 overflow-hidden">
        {editorTool === 'claude' ? <TerminalView /> : <NoCodePanel />}
      </div>
    </div>
  )
}
