import { useAppStore } from '@/stores/app-store'
import { FilesView } from './FilesView'

export function ContentArea() {
  const { contentView, currentScene } = useAppStore()

  if (contentView === 'files' && currentScene?.path) {
    return <FilesView scenePath={currentScene.path} />
  }

  // Live view — scene WCV renders here (managed by main process)
  return null
}
