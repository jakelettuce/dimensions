import chokidar, { type FSWatcher } from 'chokidar'
import path from 'path'
import { buildWidget, resolveWidgetSrcDir, resolveWidgetId } from './builder'

export interface WatcherCallbacks {
  onWidgetBuilt: (widgetId: string, success: boolean, error?: string) => void
}

// Module state packed in an object to avoid bundler issues with top-level let assignments
const watcherState: {
  watcher: FSWatcher | null
  scenePath: string | null
  buildingWidgets: Set<string>
} = {
  watcher: null,
  scenePath: null,
  buildingWidgets: new Set(),
}

// Start watching a scene's widget source directories for changes.
// On change: build widget, then notify callback.
export function watchScene(scenePath: string, callbacks: WatcherCallbacks): void {
  // Stop any previous watcher
  stopWatching()

  watcherState.scenePath = scenePath
  const widgetsDir = path.join(scenePath, 'widgets')

  watcherState.watcher = chokidar.watch(widgetsDir, {
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 100,
      pollInterval: 50,
    },
    ignored: [
      /(^|[/\\])\./,
      /node_modules/,
      /[/\\]dist[/\\]/,
    ],
    depth: 5,
  })

  const handleChange = async (filePath: string) => {
    const widgetSrcDir = resolveWidgetSrcDir(filePath)
    if (!widgetSrcDir) return

    if (watcherState.buildingWidgets.has(widgetSrcDir)) return
    watcherState.buildingWidgets.add(widgetSrcDir)

    try {
      const widgetId = resolveWidgetId(widgetSrcDir)
      const result = await buildWidget(widgetSrcDir)

      if (widgetId) {
        callbacks.onWidgetBuilt(widgetId, result.success, result.error)
      }
    } finally {
      watcherState.buildingWidgets.delete(widgetSrcDir)
    }
  }

  watcherState.watcher.on('change', handleChange)
  watcherState.watcher.on('add', handleChange)
}

export function stopWatching(): void {
  if (watcherState.watcher) {
    watcherState.watcher.close()
    watcherState.watcher = null
  }
  watcherState.scenePath = null
  watcherState.buildingWidgets.clear()
}

export function getActiveScenePath(): string | null {
  return watcherState.scenePath
}
