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

  useEffect(() => {
    // Edit mode
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

    // Widget selection
    window.dimensions.onWidgetSelect((widgetId) => {
      selectWidget(widgetId)
    })

    // Cmd+K: main process hides WCV then sends open-palette
    window.dimensions.onOpenPalette(() => {
      useAppStore.getState().openPalette()
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

    // Load initial scene
    window.dimensions.getCurrentScene().then((scene) => {
      if (scene) setCurrentScene(scene)
    })
  }, [])

  return (
    <div className={cn('flex h-full flex-col')}>
      {editMode && <TopBar />}

      <div className="flex flex-1 min-h-0">
        <div className="flex-1 relative">
          <BuildStatusToast />
        </div>
        {editMode && <EditorToolsPanel />}
      </div>

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
