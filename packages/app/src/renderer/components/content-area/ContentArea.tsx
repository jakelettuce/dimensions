import { useAppStore } from '@/stores/app-store'
import { FilesView } from './FilesView'

export function ContentArea() {
  const { contentView, currentScene, selectedWidgetId, layoutMode } = useAppStore()

  if (contentView === 'files' && currentScene?.path) {
    const inDimension = !!currentScene.dimensionId
    const rootPath = inDimension
      ? currentScene.path.replace(/\/[^/]+$/, '')
      : currentScene.path

    const title = inDimension
      ? currentScene.dimensionTitle || undefined
      : currentScene.title || undefined

    // Default file depends on layout mode
    let defaultFile = layoutMode === 'layout'
      ? currentScene.path + '/layout.html'
      : currentScene.path + '/meta.json'

    // If a widget is selected, open its source file
    if (selectedWidgetId && currentScene.widgets) {
      const widget = currentScene.widgets.find((w: any) => w.id === selectedWidgetId)
      if (widget?.manifestPath) {
        const srcDir = widget.manifestPath.replace(/\/[^/]+$/, '')
        defaultFile = currentScene.path + '/' + srcDir + '/index.html'
      }
    }

    return <FilesView scenePath={rootPath} title={title} defaultFilePath={defaultFile} />
  }

  return null
}
