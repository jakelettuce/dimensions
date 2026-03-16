import { useEffect, useRef, useCallback, useState, useMemo } from 'react'
import { useAppStore } from '@/stores/app-store'
import { cn } from '@/lib/utils'
import { Search, Zap, ArrowRight, FileText, Layers } from 'lucide-react'

interface SceneResult {
  id: string
  slug: string
  title: string
  path: string
}

interface DimensionResult {
  id: string
  title: string
  scenes: string[]
}

interface PaletteItem {
  id: string
  kind: 'action' | 'scene' | 'dimension'
  title: string
  subtitle: string
  shortcut?: string
  onSelect: () => void
}

export function CommandPalette() {
  const { paletteOpen, closePalette } = useAppStore()
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const [query, setQuery] = useState('')
  const [scenes, setScenes] = useState<SceneResult[]>([])
  const [dimensions, setDimensions] = useState<DimensionResult[]>([])
  const [selectedIndex, setSelectedIndex] = useState(0)

  const handleClose = useCallback(() => {
    closePalette()
    window.dimensions.paletteClose()
  }, [closePalette])

  // Load scenes when palette opens
  useEffect(() => {
    if (!paletteOpen) {
      setQuery('')
      setScenes([])
      setDimensions([])
      setSelectedIndex(0)
      return
    }

    setTimeout(() => inputRef.current?.focus(), 50)

    window.dimensions.listScenes().then((result: SceneResult[]) => {
      if (Array.isArray(result)) {
        setScenes(result)
      }
    }).catch(() => {
      // silently ignore — scenes may not be available
    })

    window.dimensions.listDimensions().then((result: DimensionResult[]) => {
      if (Array.isArray(result)) {
        setDimensions(result)
      }
    }).catch(() => {
      // silently ignore — dimensions may not be available
    })
  }, [paletteOpen])

  // Build the list of actions
  const actions: PaletteItem[] = useMemo(() => [
    {
      id: 'action:toggle-edit',
      kind: 'action' as const,
      title: 'Toggle Edit Mode',
      subtitle: 'Switch between edit and preview',
      shortcut: '⌘E',
      onSelect: () => {
        window.dimensions.toggleEditMode()
        handleClose()
      },
    },
    {
      id: 'action:new-scene',
      kind: 'action' as const,
      title: 'New Scene',
      subtitle: 'Create a new scene',
      onSelect: () => {
        // placeholder
        handleClose()
      },
    },
    {
      id: 'action:new-dimension',
      kind: 'action' as const,
      title: 'New Dimension',
      subtitle: 'Create a new dimension',
      onSelect: () => {
        // placeholder
        handleClose()
      },
    },
    {
      id: 'action:open-settings',
      kind: 'action' as const,
      title: 'Open Settings',
      subtitle: 'Configure application settings',
      onSelect: () => {
        // placeholder
        handleClose()
      },
    },
  ], [handleClose])

  // Build a map of scene slug -> dimension title for labeling
  const sceneDimensionMap = useMemo(() => {
    const map: Record<string, string> = {}
    for (const dim of dimensions) {
      for (const sceneSlug of dim.scenes) {
        map[sceneSlug] = dim.title
      }
    }
    return map
  }, [dimensions])

  // Build dimension items
  const dimensionItems: PaletteItem[] = useMemo(
    () =>
      dimensions.map((d) => ({
        id: `dimension:${d.id}`,
        kind: 'dimension' as const,
        title: d.title,
        subtitle: `${d.scenes.length} scene${d.scenes.length === 1 ? '' : 's'}`,
        onSelect: () => {
          window.dimensions.navigateTo(`dimensions://go/${d.id}`)
          handleClose()
        },
      })),
    [dimensions, handleClose],
  )

  // Build scene items
  const sceneItems: PaletteItem[] = useMemo(
    () =>
      scenes.map((s) => {
        const dimTitle = sceneDimensionMap[s.slug]
        return {
          id: `scene:${s.id}`,
          kind: 'scene' as const,
          title: s.title || s.slug,
          subtitle: dimTitle ? `${dimTitle} > ${s.slug}` : s.slug,
          onSelect: () => {
            window.dimensions.navigateTo(`dimensions://go/${s.id}`)
            handleClose()
          },
        }
      }),
    [scenes, sceneDimensionMap, handleClose],
  )

  // Filter by query (simple substring match)
  const filteredActions = useMemo(() => {
    if (!query) return actions
    const q = query.toLowerCase()
    return actions.filter(
      (a) =>
        a.title.toLowerCase().includes(q) ||
        a.subtitle.toLowerCase().includes(q),
    )
  }, [actions, query])

  const filteredDimensions = useMemo(() => {
    if (!query) return dimensionItems
    const q = query.toLowerCase()
    return dimensionItems.filter(
      (d) =>
        d.title.toLowerCase().includes(q) ||
        d.subtitle.toLowerCase().includes(q),
    )
  }, [dimensionItems, query])

  const filteredScenes = useMemo(() => {
    if (!query) return sceneItems
    const q = query.toLowerCase()
    return sceneItems.filter(
      (s) =>
        s.title.toLowerCase().includes(q) ||
        s.subtitle.toLowerCase().includes(q),
    )
  }, [sceneItems, query])

  const allItems = useMemo(
    () => [...filteredActions, ...filteredDimensions, ...filteredScenes],
    [filteredActions, filteredDimensions, filteredScenes],
  )

  // Reset selection when items change
  useEffect(() => {
    setSelectedIndex(0)
  }, [allItems.length])

  // Scroll selected item into view
  useEffect(() => {
    if (!listRef.current) return
    const el = listRef.current.querySelector('[data-selected="true"]')
    if (el) {
      el.scrollIntoView({ block: 'nearest' })
    }
  }, [selectedIndex])

  // Keyboard navigation
  useEffect(() => {
    if (!paletteOpen) return

    const handler = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'Escape':
          handleClose()
          break
        case 'ArrowDown':
          e.preventDefault()
          setSelectedIndex((i) => (i + 1) % Math.max(allItems.length, 1))
          break
        case 'ArrowUp':
          e.preventDefault()
          setSelectedIndex((i) =>
            i <= 0 ? Math.max(allItems.length - 1, 0) : i - 1,
          )
          break
        case 'Enter':
          e.preventDefault()
          if (allItems[selectedIndex]) {
            allItems[selectedIndex].onSelect()
          }
          break
      }
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [paletteOpen, handleClose, allItems, selectedIndex])

  if (!paletteOpen) return null

  // Compute where the section boundaries fall so we can render headers
  const actionsStart = 0
  const dimensionsStart = filteredActions.length
  const scenesStart = filteredActions.length + filteredDimensions.length

  return (
    <div
      className={cn(
        'fixed inset-0 z-50 flex items-start justify-center',
        'pt-[15vh]',
      )}
      onClick={handleClose}
    >
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/60" />

      {/* Palette card */}
      <div
        onClick={(e) => e.stopPropagation()}
        className={cn(
          'relative z-10 w-[560px] max-h-[400px] flex flex-col overflow-hidden',
          'rounded-[var(--radius-xl)]',
          'bg-[var(--color-bg-elevated)] border border-[var(--color-border)]',
          'shadow-[var(--shadow-lg)]',
        )}
      >
        {/* Search input */}
        <div
          className={cn(
            'flex items-center gap-[var(--space-md)] px-[var(--space-lg)]',
            'border-b border-[var(--color-border)] shrink-0',
          )}
        >
          <Search size={16} className="text-[var(--color-text-muted)] shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search scenes, dimensions, actions..."
            className={cn(
              'flex-1 h-12 bg-transparent border-none outline-none',
              'text-[var(--text-base)] text-[var(--color-text-primary)]',
              'placeholder:text-[var(--color-text-muted)]',
            )}
          />
        </div>

        {/* Results list */}
        <div ref={listRef} className="overflow-y-auto p-[var(--space-sm)]">
          {allItems.length === 0 && (
            <p
              className={cn(
                'text-[var(--text-xs)] text-[var(--color-text-muted)]',
                'text-center py-[var(--space-xl)]',
              )}
            >
              No results found
            </p>
          )}

          {/* Quick Actions section */}
          {filteredActions.length > 0 && (
            <>
              <div
                className={cn(
                  'px-[var(--space-md)] py-[var(--space-xs)]',
                  'text-[var(--text-xs)] text-[var(--color-text-muted)]',
                  'font-medium uppercase tracking-wider select-none',
                )}
              >
                Quick Actions
              </div>
              {filteredActions.map((item, i) => {
                const globalIndex = actionsStart + i
                const isSelected = globalIndex === selectedIndex
                return (
                  <button
                    key={item.id}
                    data-selected={isSelected}
                    onClick={item.onSelect}
                    onMouseEnter={() => setSelectedIndex(globalIndex)}
                    className={cn(
                      'flex items-center gap-[var(--space-sm)] w-full px-[var(--space-md)] py-[var(--space-sm)]',
                      'rounded-[var(--radius-md)] text-left cursor-pointer',
                      'transition-colors duration-75',
                      isSelected
                        ? 'bg-[var(--color-accent-subtle)]'
                        : 'bg-transparent hover:bg-[var(--color-accent-subtle)]',
                    )}
                  >
                    <Zap
                      size={16}
                      className={cn(
                        'shrink-0',
                        isSelected
                          ? 'text-[var(--color-accent)]'
                          : 'text-[var(--color-text-muted)]',
                      )}
                    />
                    <div className="flex-1 min-w-0">
                      <div
                        className={cn(
                          'text-[var(--text-sm)] truncate',
                          isSelected
                            ? 'text-[var(--color-accent)]'
                            : 'text-[var(--color-text-primary)]',
                        )}
                      >
                        {item.title}
                      </div>
                      <div className="text-[var(--text-xs)] text-[var(--color-text-muted)] truncate">
                        {item.subtitle}
                      </div>
                    </div>
                    {item.shortcut && (
                      <span
                        className={cn(
                          'shrink-0 text-[var(--text-xs)] text-[var(--color-text-muted)]',
                          'px-[var(--space-xs)] py-[1px]',
                          'rounded-[var(--radius-sm)] border border-[var(--color-border)]',
                          'bg-[var(--color-bg-elevated)]',
                        )}
                      >
                        {item.shortcut}
                      </span>
                    )}
                    {isSelected && (
                      <ArrowRight
                        size={14}
                        className="shrink-0 text-[var(--color-accent)]"
                      />
                    )}
                  </button>
                )
              })}
            </>
          )}

          {/* Dimensions section */}
          {filteredDimensions.length > 0 && (
            <>
              <div
                className={cn(
                  'px-[var(--space-md)] py-[var(--space-xs)]',
                  'text-[var(--text-xs)] text-[var(--color-text-muted)]',
                  'font-medium uppercase tracking-wider select-none',
                  filteredActions.length > 0 ? 'mt-[var(--space-sm)]' : '',
                )}
              >
                Dimensions
              </div>
              {filteredDimensions.map((item, i) => {
                const globalIndex = dimensionsStart + i
                const isSelected = globalIndex === selectedIndex
                return (
                  <button
                    key={item.id}
                    data-selected={isSelected}
                    onClick={item.onSelect}
                    onMouseEnter={() => setSelectedIndex(globalIndex)}
                    className={cn(
                      'flex items-center gap-[var(--space-sm)] w-full px-[var(--space-md)] py-[var(--space-sm)]',
                      'rounded-[var(--radius-md)] text-left cursor-pointer',
                      'transition-colors duration-75',
                      isSelected
                        ? 'bg-[var(--color-accent-subtle)]'
                        : 'bg-transparent hover:bg-[var(--color-accent-subtle)]',
                    )}
                  >
                    <Layers
                      size={16}
                      className={cn(
                        'shrink-0',
                        isSelected
                          ? 'text-[var(--color-accent)]'
                          : 'text-[var(--color-text-muted)]',
                      )}
                    />
                    <div className="flex-1 min-w-0">
                      <div
                        className={cn(
                          'text-[var(--text-sm)] truncate',
                          isSelected
                            ? 'text-[var(--color-accent)]'
                            : 'text-[var(--color-text-primary)]',
                        )}
                      >
                        {item.title}
                      </div>
                      <div className="text-[var(--text-xs)] text-[var(--color-text-muted)] truncate">
                        {item.subtitle}
                      </div>
                    </div>
                    {isSelected && (
                      <ArrowRight
                        size={14}
                        className="shrink-0 text-[var(--color-accent)]"
                      />
                    )}
                  </button>
                )
              })}
            </>
          )}

          {/* Recent Scenes section */}
          {filteredScenes.length > 0 && (
            <>
              <div
                className={cn(
                  'px-[var(--space-md)] py-[var(--space-xs)]',
                  'text-[var(--text-xs)] text-[var(--color-text-muted)]',
                  'font-medium uppercase tracking-wider select-none',
                  (filteredActions.length > 0 || filteredDimensions.length > 0) ? 'mt-[var(--space-sm)]' : '',
                )}
              >
                Recent Scenes
              </div>
              {filteredScenes.map((item, i) => {
                const globalIndex = scenesStart + i
                const isSelected = globalIndex === selectedIndex
                return (
                  <button
                    key={item.id}
                    data-selected={isSelected}
                    onClick={item.onSelect}
                    onMouseEnter={() => setSelectedIndex(globalIndex)}
                    className={cn(
                      'flex items-center gap-[var(--space-sm)] w-full px-[var(--space-md)] py-[var(--space-sm)]',
                      'rounded-[var(--radius-md)] text-left cursor-pointer',
                      'transition-colors duration-75',
                      isSelected
                        ? 'bg-[var(--color-accent-subtle)]'
                        : 'bg-transparent hover:bg-[var(--color-accent-subtle)]',
                    )}
                  >
                    <FileText
                      size={16}
                      className={cn(
                        'shrink-0',
                        isSelected
                          ? 'text-[var(--color-accent)]'
                          : 'text-[var(--color-text-muted)]',
                      )}
                    />
                    <div className="flex-1 min-w-0">
                      <div
                        className={cn(
                          'text-[var(--text-sm)] truncate',
                          isSelected
                            ? 'text-[var(--color-accent)]'
                            : 'text-[var(--color-text-primary)]',
                        )}
                      >
                        {item.title}
                      </div>
                      <div className="text-[var(--text-xs)] text-[var(--color-text-muted)] truncate">
                        {item.subtitle}
                      </div>
                    </div>
                    {isSelected && (
                      <ArrowRight
                        size={14}
                        className="shrink-0 text-[var(--color-accent)]"
                      />
                    )}
                  </button>
                )
              })}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
