import chokidar, { type FSWatcher } from 'chokidar'
import path from 'path'
import { buildWidget, resolveWidgetSrcDir, resolveWidgetId } from './builder'

export interface WatcherCallbacks {
  onWidgetBuilt: (widgetId: string, success: boolean, error?: string) => void
  onSceneMetaChanged?: () => void
}

const watcherState: {
  watcher: FSWatcher | null
  metaWatcher: FSWatcher | null
  scenePath: string | null
  buildingWidgets: Set<string>
} = {
  watcher: null,
  metaWatcher: null,
  scenePath: null,
  buildingWidgets: new Set(),
}

// Watch a scene's widget sources AND meta.json/connections.json for changes.
export function watchScene(scenePath: string, callbacks: WatcherCallbacks): void {
  stopWatching()

  watcherState.scenePath = scenePath
  const widgetsDir = path.join(scenePath, 'widgets')

  // Watch widget source files
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

  // Watch meta.json and connections.json for scene-level changes
  const metaPath = path.join(scenePath, 'meta.json')
  const connectionsPath = path.join(scenePath, 'connections.json')

  watcherState.metaWatcher = chokidar.watch([metaPath, connectionsPath], {
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 200,
      pollInterval: 50,
    },
  })

  watcherState.metaWatcher.on('change', () => {
    if (callbacks.onSceneMetaChanged) {
      callbacks.onSceneMetaChanged()
    }
  })
}

export function stopWatching(): void {
  if (watcherState.watcher) {
    watcherState.watcher.close()
    watcherState.watcher = null
  }
  if (watcherState.metaWatcher) {
    watcherState.metaWatcher.close()
    watcherState.metaWatcher = null
  }
  watcherState.scenePath = null
  watcherState.buildingWidgets.clear()
}

export function getActiveScenePath(): string | null {
  return watcherState.scenePath
}
