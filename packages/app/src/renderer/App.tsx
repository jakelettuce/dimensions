import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/stores/app-store'

declare global {
  interface Window {
    dimensions: {
      platform: string
      navigateTo: (url: string) => Promise<any>
      getCurrentScene: () => Promise<any>
      toggleEditMode: () => Promise<boolean>
      onEditModeChange: (cb: (editing: boolean) => void) => void
      onWidgetBuildStatus: (cb: (status: { widgetId: string; success: boolean; error?: string }) => void) => void
      onAppNavigate: (cb: (route: string) => void) => void
      listScenes: () => Promise<any>
      listDimensions: () => Promise<any>
      readDir: (dirPath: string) => Promise<any>
      readFile: (filePath: string) => Promise<any>
      writeFile: (filePath: string, content: string) => Promise<any>
      getEnvKeys: () => Promise<any>
      setEnvVar: (key: string, value: string) => Promise<any>
      deleteEnvVar: (key: string) => Promise<any>
      createTerminal: (scenePath: string) => Promise<any>
      sendTerminalInput: (id: string, data: string) => void
      onTerminalOutput: (id: string, cb: (data: string) => void) => void
    }
  }
}

export default function App() {
  const { editMode, toggleEditMode } = useAppStore()
  const [scene, setScene] = useState<any>(null)
  const [buildStatus, setBuildStatus] = useState<string>('')

  useEffect(() => {
    // Listen for edit mode changes from main process
    window.dimensions.onEditModeChange((editing) => {
      useAppStore.setState({ editMode: editing })
    })

    // Listen for build status
    window.dimensions.onWidgetBuildStatus((status) => {
      const msg = status.success
        ? `Widget "${status.widgetId}" built successfully`
        : `Widget "${status.widgetId}" build failed: ${status.error}`
      setBuildStatus(msg)
      setTimeout(() => setBuildStatus(''), 3000)
    })

    // Load current scene info
    window.dimensions.getCurrentScene().then(setScene)
  }, [])

  return (
    <div className={cn('flex h-full flex-col')}>
      {/* Top bar — drag region */}
      <div
        className={cn(
          'drag-region flex items-center justify-between border-b px-4',
          'h-[var(--topbar-height)] bg-[var(--color-bg-secondary)] border-[var(--color-border)]',
        )}
      >
        <div className="flex items-center gap-3">
          {/* Traffic light spacer on macOS */}
          <div className="w-[70px]" />
          <h1
            className={cn(
              'text-[var(--text-sm)] font-medium no-drag cursor-default',
              'text-[var(--color-text-primary)]',
            )}
          >
            {scene?.title ?? 'Dimensions'}
          </h1>
        </div>

        <div className="flex items-center gap-2 no-drag">
          {editMode && (
            <span
              className={cn(
                'rounded-[var(--radius-sm)] px-2 py-0.5',
                'bg-[var(--color-accent-subtle)] text-[var(--color-accent)]',
                'text-[var(--text-xs)] font-medium',
              )}
            >
              Edit
            </span>
          )}
        </div>
      </div>

      {/* Content area */}
      <div className={cn('flex flex-1 items-center justify-center bg-[var(--color-bg-primary)]')}>
        <div className="text-center">
          <h2
            className={cn(
              'text-[var(--text-xl)] font-semibold',
              'text-[var(--color-text-primary)] mb-[var(--space-md)]',
            )}
          >
            {scene?.title ?? 'Welcome to Dimensions'}
          </h2>
          <p className="text-[var(--text-sm)] text-[var(--color-text-secondary)] mb-[var(--space-lg)]">
            {scene ? `Scene loaded: ${scene.slug}` : 'Loading scene...'}
          </p>

          {buildStatus && (
            <p
              className={cn(
                'text-[var(--text-xs)] font-mono mb-[var(--space-md)]',
                buildStatus.includes('failed')
                  ? 'text-[var(--color-error)]'
                  : 'text-[var(--color-success)]',
              )}
            >
              {buildStatus}
            </p>
          )}

          <div
            className={cn(
              'inline-block rounded-[var(--radius-lg)] px-[var(--space-lg)] py-[var(--space-sm)]',
              'bg-[var(--color-accent-subtle)] text-[var(--color-accent)]',
              'text-[var(--text-xs)] font-mono',
            )}
          >
            Phase 2: Core Runtime
          </div>
        </div>
      </div>
    </div>
  )
}
