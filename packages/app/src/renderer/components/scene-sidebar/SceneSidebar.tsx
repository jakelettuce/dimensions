import { useEffect, useState, useCallback } from 'react'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/stores/app-store'
import { Layers, FileText, Plus, Star } from 'lucide-react'

interface DimensionInfo {
  id: string
  title: string
  scenes: string[]
}

interface SceneInfo {
  id: string
  slug: string
  title: string
  path: string
  dimensionTitle?: string
}

export function SceneSidebar() {
  const { currentScene } = useAppStore()
  const [dimensions, setDimensions] = useState<DimensionInfo[]>([])
  const [scenes, setScenes] = useState<SceneInfo[]>([])

  // Load dimensions and scenes
  useEffect(() => {
    Promise.all([
      window.dimensions.listDimensions(),
      window.dimensions.listScenes(),
    ]).then(([dims, scns]) => {
      setDimensions(Array.isArray(dims) ? dims : [])
      setScenes(Array.isArray(scns) ? scns : [])
    })
  }, [currentScene?.path])

  const navigateTo = useCallback((id: string) => {
    window.dimensions.navigateTo(`dimensions://go/${id}`)
  }, [])

  const handleNewScene = useCallback(() => {
    // Open command palette in new-scene mode
    useAppStore.getState().openPalette()
    // Small delay so palette renders first
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent('palette-new-scene'))
    }, 50)
  }, [])

  // Group scenes by dimension
  const standaloneScenes = scenes.filter((s) => !s.dimensionTitle)
  const currentDimTitle = currentScene?.dimensionTitle

  return (
    <div
      className={cn(
        'w-[280px] shrink-0 flex flex-col',
        'bg-[var(--color-bg-secondary)] border-r border-[var(--color-border)]',
        'overflow-hidden',
      )}
    >
      {/* Header */}
      <div className="px-4 py-3 border-b border-[var(--color-border)]">
        <h2 className="text-[var(--text-sm)] font-semibold text-[var(--color-text-primary)]">
          Scenes
        </h2>
      </div>

      <div className="flex-1 overflow-y-auto py-2">
        {/* Dimensions */}
        {dimensions.map((dim) => (
          <DimensionGroup
            key={dim.id}
            dimension={dim}
            scenes={scenes.filter((s) => s.dimensionTitle === dim.title)}
            currentSceneId={currentScene?.id ?? null}
            currentDimTitle={currentDimTitle ?? null}
            onNavigate={navigateTo}
          />
        ))}

        {/* Standalone scenes */}
        {standaloneScenes.length > 0 && (
          <div className="mt-2">
            <div className="px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
              Standalone
            </div>
            {standaloneScenes.map((scene) => (
              <SceneItem
                key={scene.id}
                scene={scene}
                isActive={scene.id === currentScene?.id}
                isEntry={false}
                onClick={() => navigateTo(scene.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* New Scene button */}
      <div className="p-3 border-t border-[var(--color-border)]">
        <button
          onClick={handleNewScene}
          className={cn(
            'w-full flex items-center justify-center gap-2 py-2 rounded-[var(--radius-md)]',
            'text-[var(--text-xs)] font-medium',
            'bg-[var(--color-bg-hover)] text-[var(--color-text-secondary)]',
            'hover:bg-[var(--color-accent-subtle)] hover:text-[var(--color-accent)]',
            'transition-colors duration-[var(--duration-fast)]',
          )}
        >
          <Plus size={14} />
          New Scene
        </button>
      </div>
    </div>
  )
}

function DimensionGroup({
  dimension,
  scenes,
  currentSceneId,
  currentDimTitle,
  onNavigate,
}: {
  dimension: DimensionInfo
  scenes: SceneInfo[]
  currentSceneId: string | null
  currentDimTitle: string | null
  onNavigate: (id: string) => void
}) {
  const isCurrentDimension = currentDimTitle === dimension.title

  return (
    <div className="mb-1">
      <div
        className={cn(
          'flex items-center gap-2 px-4 py-1.5',
          'text-[10px] font-semibold uppercase tracking-wider',
          isCurrentDimension
            ? 'text-[var(--color-accent)]'
            : 'text-[var(--color-text-muted)]',
        )}
      >
        <Layers size={12} />
        {dimension.title}
      </div>

      {/* Show scenes in dimension order — match by slug or title */}
      {dimension.scenes.map((sceneSlug) => {
        const scene = scenes.find((s) => s.slug === sceneSlug || s.title.toLowerCase() === sceneSlug)
        if (!scene) return null
        const isEntry = dimension.scenes[0] === sceneSlug
        return (
          <SceneItem
            key={scene.id}
            scene={scene}
            isActive={scene.id === currentSceneId}
            isEntry={isEntry}
            onClick={() => onNavigate(scene.id)}
          />
        )
      })}
    </div>
  )
}

function SceneItem({
  scene,
  isActive,
  isEntry,
  onClick,
}: {
  scene: SceneInfo
  isActive: boolean
  isEntry: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full flex items-center gap-2 px-4 py-1.5 text-left',
        'text-[var(--text-xs)] transition-colors duration-[var(--duration-fast)]',
        isActive
          ? 'bg-[var(--color-accent-subtle)] text-[var(--color-accent)] font-medium'
          : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]',
      )}
    >
      <FileText size={13} className="shrink-0 opacity-50" />
      <span className="truncate">{scene.title}</span>
      {isEntry && (
        <Star size={10} className="shrink-0 text-[var(--color-text-muted)] opacity-60" />
      )}
    </button>
  )
}
