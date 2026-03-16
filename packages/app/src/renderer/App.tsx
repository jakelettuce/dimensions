import { useEffect } from 'react'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/stores/app-store'
import { TopBar } from '@/components/top-bar/TopBar'
import { EditorToolsPanel } from '@/components/editor-tools/EditorToolsPanel'
import { CommandPalette } from '@/components/command-palette/CommandPalette'
import '@xterm/xterm/css/xterm.css'

export default function App() {
  const { editMode, setEditMode, setCurrentScene, selectWidget, setBuildStatus } =
    useAppStore()

  // Wire up IPC listeners from main process (global shortcuts + events)
  useEffect(() => {
    // Edit mode changes
    window.dimensions.onEditModeChange((editing) => {
      setEditMode(editing)
    })

    // Build status
    window.dimensions.onWidgetBuildStatus((status) => {
      const msg = status.success
        ? `Built: ${status.widgetId}`
        : `Build failed: ${status.widgetId} — ${status.error}`
      setBuildStatus(msg)
      setTimeout(() => setBuildStatus(''), 4000)
    })

    // Widget selection from scene WCV
    window.dimensions.onWidgetSelect((widgetId) => {
      selectWidget(widgetId)
    })

    // Global shortcut messages from main process
    window.dimensions.onTogglePalette(() => {
      const store = useAppStore.getState()
      if (store.paletteOpen) store.closePalette()
      else store.openPalette()
    })

    window.dimensions.onSetEditorTool((tool) => {
      if (tool === 'claude' || tool === 'nocode') {
        useAppStore.getState().setEditorTool(tool)
      }
    })

    window.dimensions.onNavigateBack(() => {
      window.dimensions.navigateTo('dimensions://back')
    })

    window.dimensions.onNavigateForward(() => {
      window.dimensions.navigateTo('dimensions://forward')
    })

    window.dimensions.onToggleContentView(() => {
      const store = useAppStore.getState()
      store.setContentView(store.contentView === 'live' ? 'files' : 'live')
    })

    window.dimensions.onFocusTerminal(() => {
      useAppStore.getState().setEditorTool('claude')
    })

    // Load initial scene info
    window.dimensions.getCurrentScene().then((scene) => {
      if (scene) setCurrentScene(scene)
    })
  }, [])

  return (
    <div className={cn('flex h-full flex-col')}>
      {/* Top bar — always visible in edit mode */}
      {editMode && <TopBar />}

      {/* Main content area */}
      <div className="flex flex-1 min-h-0">
        {/* Content area — scene WCV is positioned here by the main process */}
        <div className="flex-1 relative">
          {/* Build status toast */}
          <BuildStatusToast />

          {/* In use mode, scene fills the window (WCV bounds set by main process) */}
          {/* In edit mode, scene WCV is shrunk to make room for top bar + editor panel */}
          {!editMode && (
            <div className={cn(
              'absolute inset-0 flex items-center justify-center',
              'bg-[var(--color-bg-primary)] pointer-events-none',
            )}>
              {/* Placeholder shown while scene WCV loads on top */}
            </div>
          )}
        </div>

        {/* Editor tools panel — right sidebar, only in edit mode */}
        {editMode && <EditorToolsPanel />}
      </div>

      {/* Command palette overlay */}
      <CommandPalette />
    </div>
  )
}

function BuildStatusToast() {
  const { buildStatus } = useAppStore()
  if (!buildStatus) return null

  return (
    <div
      className={cn(
        'absolute bottom-[var(--space-lg)] left-1/2 -translate-x-1/2 z-40',
        'rounded-[var(--radius-lg)] px-[var(--space-lg)] py-[var(--space-sm)]',
        'text-[var(--text-xs)] font-mono shadow-[var(--shadow-md)]',
        buildStatus.includes('failed')
          ? 'bg-[var(--color-error)] text-white'
          : 'bg-[var(--color-bg-elevated)] text-[var(--color-success)] border border-[var(--color-border)]',
      )}
    >
      {buildStatus}
    </div>
  )
}
