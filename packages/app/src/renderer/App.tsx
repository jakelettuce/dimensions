import { useEffect } from 'react'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/stores/app-store'
import { TopBar } from '@/components/top-bar/TopBar'
import { EditorToolsPanel } from '@/components/editor-tools/EditorToolsPanel'
import { ContentArea } from '@/components/content-area/ContentArea'
import { CommandPalette } from '@/components/command-palette/CommandPalette'
import { SceneSidebar } from '@/components/scene-sidebar/SceneSidebar'
import '@xterm/xterm/css/xterm.css'

export default function App() {
  const { editMode, sceneSidebarOpen, setEditMode, setCurrentScene, setSceneSidebarOpen, selectWidget, setBuildStatus } =
    useAppStore()

  useEffect(() => {
    // Edit mode — when leaving, switch back to live view
    window.dimensions.onEditModeChange((editing) => {
      setEditMode(editing)
      if (!editing) {
        const store = useAppStore.getState()
        if (store.contentView === 'files') {
          store.setContentView('live')
          window.dimensions.toggleWcvVisibility(true)
        }
      }
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
      const newView = store.contentView === 'live' ? 'files' : 'live'
      store.setContentView(newView)
      window.dimensions.toggleWcvVisibility(newView === 'live')
    })

    window.dimensions.onFocusTerminal(() => {
      useAppStore.getState().setEditorTool('claude')
    })

    // Scene sidebar toggle
    window.dimensions.onSceneSidebarChange((open) => {
      setSceneSidebarOpen(open)
    })

    // Scene changed (navigation, sequential nav, etc.)
    window.dimensions.onSceneChanged((scene) => {
      if (scene) setCurrentScene(scene)
    })

    // Load initial scene
    window.dimensions.getCurrentScene().then((scene) => {
      if (scene) setCurrentScene(scene)
    })
  }, [])

  return (
    <div className={cn('flex h-full flex-col')}>
      <TopBar />

      <div className="flex flex-1 min-h-0">
        {sceneSidebarOpen && <SceneSidebar />}
        <div className="flex-1 relative">
          <ContentArea />
          <BuildStatusToast />
        </div>
        <div className={editMode ? '' : 'hidden'}>
          <EditorToolsPanel />
        </div>
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
