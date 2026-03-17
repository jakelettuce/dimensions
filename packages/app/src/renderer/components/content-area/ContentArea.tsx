import { useAppStore } from '@/stores/app-store'
import { FilesView } from './FilesView'

export function ContentArea() {
  const { contentView, currentScene } = useAppStore()

  if (contentView === 'files' && currentScene?.path) {
    const inDimension = !!currentScene.dimensionId
    const rootPath = inDimension
      ? currentScene.path.replace(/\/[^/]+$/, '')
      : currentScene.path

    const title = inDimension
      ? currentScene.dimensionTitle || undefined
      : currentScene.title || undefined

    // Default to current scene's meta.json if no file is open
    const defaultFile = currentScene.path + '/meta.json'

    return <FilesView scenePath={rootPath} title={title} defaultFilePath={defaultFile} />
  }

  return null
}
