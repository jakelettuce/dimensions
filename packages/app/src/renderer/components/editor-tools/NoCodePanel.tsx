import { cn } from '@/lib/utils'
import { useAppStore } from '@/stores/app-store'

export function NoCodePanel() {
  const { selectedWidgetId, currentScene } = useAppStore()

  const selectedWidget = currentScene?.widgets.find(
    (w: any) => w.id === selectedWidgetId,
  )

  return (
    <div className={cn('h-full overflow-y-auto p-[var(--space-lg)]')}>
      {selectedWidget ? (
        <div>
          <h3
            className={cn(
              'text-[var(--text-sm)] font-medium mb-[var(--space-md)]',
              'text-[var(--color-text-primary)]',
            )}
          >
            Widget Properties
          </h3>
          <div className="space-y-[var(--space-md)]">
            <div>
              <label className="text-[var(--text-xs)] text-[var(--color-text-muted)] block mb-1">
                Instance ID
              </label>
              <div className="text-[var(--text-xs)] font-mono text-[var(--color-text-secondary)]">
                {selectedWidget.id}
              </div>
            </div>
            <div>
              <label className="text-[var(--text-xs)] text-[var(--color-text-muted)] block mb-1">
                Type
              </label>
              <div className="text-[var(--text-xs)] font-mono text-[var(--color-text-secondary)]">
                {selectedWidget.widgetType}
              </div>
            </div>
            <div>
              <label className="text-[var(--text-xs)] text-[var(--color-text-muted)] block mb-1">
                Position
              </label>
              <div className="text-[var(--text-xs)] font-mono text-[var(--color-text-secondary)]">
                x: {selectedWidget.bounds?.x}, y: {selectedWidget.bounds?.y}
              </div>
            </div>
            <div>
              <label className="text-[var(--text-xs)] text-[var(--color-text-muted)] block mb-1">
                Size
              </label>
              <div className="text-[var(--text-xs)] font-mono text-[var(--color-text-secondary)]">
                {selectedWidget.bounds?.width} x {selectedWidget.bounds?.height}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="text-center pt-[var(--space-2xl)]">
          <p className="text-[var(--text-sm)] text-[var(--color-text-muted)]">
            Select a widget to view properties
          </p>
          <p className="text-[var(--text-xs)] text-[var(--color-text-muted)] mt-[var(--space-sm)]">
            Click a widget in the scene while in edit mode
          </p>
        </div>
      )}

      {/* Scene properties */}
      {currentScene && (
        <div className="mt-[var(--space-2xl)] pt-[var(--space-lg)] border-t border-[var(--color-border-subtle)]">
          <h3
            className={cn(
              'text-[var(--text-sm)] font-medium mb-[var(--space-md)]',
              'text-[var(--color-text-primary)]',
            )}
          >
            Scene
          </h3>
          <div className="space-y-[var(--space-md)]">
            <div>
              <label className="text-[var(--text-xs)] text-[var(--color-text-muted)] block mb-1">
                Title
              </label>
              <div className="text-[var(--text-xs)] text-[var(--color-text-secondary)]">
                {currentScene.title}
              </div>
            </div>
            <div>
              <label className="text-[var(--text-xs)] text-[var(--color-text-muted)] block mb-1">
                Slug
              </label>
              <div className="text-[var(--text-xs)] font-mono text-[var(--color-text-secondary)]">
                {currentScene.slug}
              </div>
            </div>
            <div>
              <label className="text-[var(--text-xs)] text-[var(--color-text-muted)] block mb-1">
                Widgets
              </label>
              <div className="text-[var(--text-xs)] text-[var(--color-text-secondary)]">
                {currentScene.widgets?.length ?? 0} widget(s)
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
