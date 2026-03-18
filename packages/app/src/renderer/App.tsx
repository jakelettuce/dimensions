import { useCallback, useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/stores/app-store'
import { TopBar } from '@/components/top-bar/TopBar'
import { EditorToolsPanel } from '@/components/editor-tools/EditorToolsPanel'
import { ContentArea } from '@/components/content-area/ContentArea'
import { CommandPalette } from '@/components/command-palette/CommandPalette'
import { SceneSidebar } from '@/components/scene-sidebar/SceneSidebar'
import { ToolBar } from '@/components/top-bar/ToolBar'
import { ResizeHandle } from '@/components/ResizeHandle'
import { DownloadConfirmModal, type DownloadRequest } from '@/components/download-modal/DownloadConfirmModal'
import '@xterm/xterm/css/xterm.css'

export default function App() {
  const {
    editMode, sceneSidebarOpen,
    setEditMode, setCurrentScene, setSceneSidebarOpen, selectWidget, setBuildStatus,
    sceneSidebarWidth, setSceneSidebarWidth,
    editorPanelWidth, setEditorPanelWidth,
  } = useAppStore()

  const [downloadRequest, setDownloadRequest] = useState<DownloadRequest | null>(null)

  useEffect(() => {
    window.dimensions.onDownloadConfirm((data) => {
      // One modal at a time — cancel new downloads if one is already pending
      if (downloadRequest) {
        window.dimensions.cancelDownload(data.downloadId)
        return
      }
      setDownloadRequest(data)
    })
    window.dimensions.onDownloadComplete((data) => {
      if (data.state === 'completed') {
        setBuildStatus(`Downloaded: ${data.filename}`)
        setTimeout(() => setBuildStatus(''), 4000)
      }
    })
    window.dimensions.onDownloadTimeout((data) => {
      setDownloadRequest(prev => prev?.downloadId === data.downloadId ? null : prev)
    })
  }, [])

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
      if (scene) {
        setCurrentScene(scene)
        if (scene.layoutMode) useAppStore.getState().setLayoutMode(scene.layoutMode)
        if (scene.scaleMode) useAppStore.getState().setScaleMode(scene.scaleMode)
      }
    })

    // Scale mode and zoom changes from main process
    window.dimensions.onScaleModeChange((mode: string) => {
      if (mode === 'fit' || mode === 'original') {
        useAppStore.getState().setScaleMode(mode)
      }
    })

    window.dimensions.onZoomChange((zoom: number) => {
      useAppStore.getState().setZoom(zoom)
    })

    // Widget props updated — update the store so NoCodePanel reflects changes
    window.dimensions.onWidgetPropsUpdated(({ widgetId, props }) => {
      const store = useAppStore.getState()
      if (store.currentScene?.widgets) {
        const updated = store.currentScene.widgets.map((w: any) =>
          w.id === widgetId ? { ...w, props } : w
        )
        store.setCurrentScene({ ...store.currentScene, widgets: updated })
      }
    })

    // Load initial scene
    window.dimensions.getCurrentScene().then((scene) => {
      if (scene) {
        setCurrentScene(scene)
        if (scene?.layoutMode) useAppStore.getState().setLayoutMode(scene.layoutMode)
        if (scene?.scaleMode) useAppStore.getState().setScaleMode(scene.scaleMode)
      }
    })
  }, [])

  // Debounced sync to main process — only fire every 16ms (one frame)
  const syncTimerRef = useRef<ReturnType<typeof requestAnimationFrame> | null>(null)
  const pendingWidthsRef = useRef<{ sw: number; ew: number } | null>(null)

  const syncWidths = useCallback((sw: number, ew: number) => {
    pendingWidthsRef.current = { sw, ew }
    if (!syncTimerRef.current) {
      syncTimerRef.current = requestAnimationFrame(() => {
        syncTimerRef.current = null
        const p = pendingWidthsRef.current
        if (p) window.dimensions.updatePanelWidths(p.sw, p.ew)
      })
    }
  }, [])

  const handleSidebarResize = useCallback((delta: number) => {
    const store = useAppStore.getState()
    const newW = Math.max(200, Math.min(500, store.sceneSidebarWidth + delta))
    store.setSceneSidebarWidth(newW)
    syncWidths(newW, store.editorPanelWidth)
  }, [syncWidths])

  const handleEditorResize = useCallback((delta: number) => {
    const store = useAppStore.getState()
    const newW = Math.max(280, Math.min(700, store.editorPanelWidth + delta))
    store.setEditorPanelWidth(newW)
    syncWidths(store.sceneSidebarWidth, newW)
  }, [syncWidths])

  return (
    <div className={cn('flex h-full')}>
      {/* Scene sidebar — full height, leftmost */}
      {sceneSidebarOpen && (
        <>
          <div style={{ width: sceneSidebarWidth }} className="shrink-0 flex">
            <SceneSidebar />
          </div>
          <ResizeHandle side="left" onResize={handleSidebarResize} />
        </>
      )}

      {/* Main area (bars + content + editor) */}
      <div className="flex-1 flex flex-col min-w-0">
        <TopBar />
        {editMode && <ToolBar />}

        <div className="flex flex-1 min-h-0">
          <div className="flex-1 relative">
            <ContentArea />
            <BuildStatusToast />
          </div>
          {editMode && <ResizeHandle side="right" onResize={handleEditorResize} />}
          <div style={{ width: editorPanelWidth }} className={editMode ? 'shrink-0 flex' : 'hidden'}>
            <EditorToolsPanel />
          </div>
        </div>
      </div>

      <CommandPalette />
      {downloadRequest && (
        <DownloadConfirmModal
          request={downloadRequest}
          onClose={() => setDownloadRequest(null)}
        />
      )}
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
