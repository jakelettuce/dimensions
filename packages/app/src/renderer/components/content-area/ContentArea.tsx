import { useAppStore } from '@/stores/app-store'
import { FilesView } from './FilesView'

export function ContentArea() {
  const { contentView, currentScene, selectedWidgetId } = useAppStore()

  if (contentView === 'files' && currentScene?.path) {
    const inDimension = !!currentScene.dimensionId
    const rootPath = inDimension
      ? currentScene.path.replace(/\/[^/]+$/, '')
      : currentScene.path

    const title = inDimension
      ? currentScene.dimensionTitle || undefined
      : currentScene.title || undefined

    // If a widget is selected, open its source file
    let defaultFile = currentScene.path + '/meta.json'
    if (selectedWidgetId && currentScene.widgets) {
      const widget = currentScene.widgets.find((w: any) => w.id === selectedWidgetId)
      if (widget?.manifestPath) {
        // manifestPath is like "widgets/welcome/src/widget.manifest.json"
        // We want "widgets/welcome/src/index.html"
        const srcDir = widget.manifestPath.replace(/\/[^/]+$/, '') // strip filename
        defaultFile = currentScene.path + '/' + srcDir + '/index.html'
      }
    }

    return <FilesView scenePath={rootPath} title={title} defaultFilePath={defaultFile} />
  }

  return null
}
