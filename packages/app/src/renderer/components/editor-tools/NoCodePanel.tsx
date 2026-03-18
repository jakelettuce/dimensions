import { cn } from '@/lib/utils'
import { useAppStore } from '@/stores/app-store'
import { useState, useEffect, useRef, useCallback } from 'react'
import { RotateCcw } from 'lucide-react'

// ── Prop input components ──

function StringInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [local, setLocal] = useState(value)
  const timer = useRef<ReturnType<typeof setTimeout>>()
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => { setLocal(value) }, [value])
  const handleChange = (v: string) => {
    setLocal(v)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => onChange(v), 200)
  }
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      clearTimeout(timer.current)
      onChange(local)
      inputRef.current?.blur()
    }
  }
  return (
    <input
      ref={inputRef}
      type="text"
      value={local}
      onChange={(e) => handleChange(e.target.value)}
      onKeyDown={handleKeyDown}
      className={cn(
        'w-full bg-[var(--color-bg-primary)] border border-[var(--color-border)]',
        'rounded-[var(--radius-md)] px-2 py-1',
        'text-[var(--text-xs)] text-[var(--color-text-secondary)]',
        'outline-none focus:border-[var(--color-accent)]',
      )}
    />
  )
}

function NumberInput({ value, onChange, min, max, step }: {
  value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number
}) {
  const [local, setLocal] = useState(String(value))
  const timer = useRef<ReturnType<typeof setTimeout>>()
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => { setLocal(String(value)) }, [value])
  const handleChange = (v: string) => {
    setLocal(v)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      const n = parseFloat(v)
      if (!isNaN(n)) onChange(n)
    }, 200)
  }
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      clearTimeout(timer.current)
      const n = parseFloat(local)
      if (!isNaN(n)) onChange(n)
      inputRef.current?.blur()
    }
  }
  return (
    <input
      ref={inputRef}
      type="number"
      value={local}
      min={min}
      max={max}
      step={step}
      onChange={(e) => handleChange(e.target.value)}
      onKeyDown={handleKeyDown}
      className={cn(
        'w-full bg-[var(--color-bg-primary)] border border-[var(--color-border)]',
        'rounded-[var(--radius-md)] px-2 py-1',
        'text-[var(--text-xs)] text-[var(--color-text-secondary)]',
        'outline-none focus:border-[var(--color-accent)]',
      )}
    />
  )
}

function BooleanInput({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!value)}
      className={cn(
        'relative w-8 h-[18px] rounded-full transition-colors duration-[var(--duration-fast)]',
        value ? 'bg-[var(--color-accent)]' : 'bg-[var(--color-border)]',
      )}
    >
      <div
        className={cn(
          'absolute top-[2px] w-[14px] h-[14px] rounded-full bg-white transition-transform duration-[var(--duration-fast)]',
          value ? 'translate-x-[16px]' : 'translate-x-[2px]',
        )}
      />
    </button>
  )
}

function ColorInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-6 h-6 rounded border-none cursor-pointer bg-transparent"
      />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          'flex-1 bg-[var(--color-bg-primary)] border border-[var(--color-border)]',
          'rounded-[var(--radius-md)] px-2 py-1',
          'text-[var(--text-xs)] font-mono text-[var(--color-text-secondary)]',
          'outline-none focus:border-[var(--color-accent)]',
        )}
      />
    </div>
  )
}

function SelectInput({ value, options, onChange }: {
  value: string; options: string[]; onChange: (v: string) => void
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        'w-full bg-[var(--color-bg-primary)] border border-[var(--color-border)]',
        'rounded-[var(--radius-md)] px-2 py-1',
        'text-[var(--text-xs)] text-[var(--color-text-secondary)]',
        'outline-none focus:border-[var(--color-accent)]',
      )}
    >
      {options.map((opt) => (
        <option key={opt} value={opt}>{opt}</option>
      ))}
    </select>
  )
}

function ArrayInput({ value, onChange, itemType }: {
  value: string[]; onChange: (v: string[]) => void; itemType?: string
}) {
  const items = Array.isArray(value) ? value : []

  const handleItemChange = (index: number, newVal: string) => {
    const updated = [...items]
    updated[index] = newVal
    onChange(updated)
  }

  const handleRemove = (index: number) => {
    onChange(items.filter((_, i) => i !== index))
  }

  const handleAdd = () => {
    onChange([...items, ''])
  }

  return (
    <div className="space-y-1.5">
      {items.map((item, i) => (
        <div key={i} className="flex items-center gap-1">
          <input
            type={itemType === 'number' ? 'number' : 'text'}
            value={item}
            onChange={(e) => handleItemChange(i, e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
            }}
            className={cn(
              'flex-1 bg-[var(--color-bg-primary)] border border-[var(--color-border)]',
              'rounded-[var(--radius-md)] px-2 py-1',
              'text-[var(--text-xs)] text-[var(--color-text-secondary)]',
              'outline-none focus:border-[var(--color-accent)]',
            )}
          />
          <button
            onClick={() => handleRemove(i)}
            className="text-[var(--color-text-muted)] hover:text-red-400 transition-colors text-xs px-1"
          >
            ×
          </button>
        </div>
      ))}
      <button
        onClick={handleAdd}
        className={cn(
          'w-full py-1 rounded-[var(--radius-md)]',
          'border border-dashed border-[var(--color-border)]',
          'text-[var(--text-xs)] text-[var(--color-text-muted)]',
          'hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]',
          'transition-colors',
        )}
      >
        + Add item
      </button>
    </div>
  )
}

// ── Prop row ──

function PropRow({ prop, value, defaultValue, widgetId }: {
  prop: any
  value: any
  defaultValue: any
  widgetId: string
}) {
  const isOverridden = value !== undefined && value !== defaultValue
  const effectiveValue = value ?? defaultValue ?? ''

  const handleChange = useCallback((newValue: any) => {
    window.dimensions.setWidgetProp(widgetId, prop.key, newValue)
  }, [widgetId, prop.key])

  const handleReset = useCallback(() => {
    window.dimensions.resetWidgetProp(widgetId, prop.key)
  }, [widgetId, prop.key])

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <label className={cn(
          'text-[var(--text-xs)] block',
          isOverridden ? 'text-[var(--color-text-primary)] font-medium' : 'text-[var(--color-text-muted)]',
        )}>
          {isOverridden && <span className="inline-block w-1.5 h-1.5 rounded-full bg-[var(--color-accent)] mr-1.5 -translate-y-px" />}
          {prop.label || prop.key}
        </label>
        {isOverridden && (
          <button
            onClick={handleReset}
            className="text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] transition-colors"
            title="Reset to default"
          >
            <RotateCcw size={10} />
          </button>
        )}
      </div>
      {prop.type === 'string' && <StringInput value={effectiveValue} onChange={handleChange} />}
      {prop.type === 'number' && <NumberInput value={effectiveValue} onChange={handleChange} min={prop.min} max={prop.max} step={prop.step} />}
      {prop.type === 'boolean' && <BooleanInput value={!!effectiveValue} onChange={handleChange} />}
      {prop.type === 'color' && <ColorInput value={effectiveValue} onChange={handleChange} />}
      {prop.type === 'select' && <SelectInput value={effectiveValue} options={prop.options || []} onChange={handleChange} />}
      {prop.type === 'scene' && <StringInput value={effectiveValue || ''} onChange={handleChange} />}
      {prop.type === 'array' && <ArrayInput value={Array.isArray(effectiveValue) ? effectiveValue : []} onChange={handleChange} itemType={prop.itemType} />}
    </div>
  )
}

// ── Main panel ──

export function NoCodePanel() {
  const { selectedWidgetId, currentScene } = useAppStore()
  const [manifestProps, setManifestProps] = useState<any[]>([])

  const selectedWidget = currentScene?.widgets.find(
    (w: any) => w.id === selectedWidgetId,
  )

  // Load manifest props for the selected widget
  useEffect(() => {
    if (!selectedWidget?.manifestPath || !currentScene?.path) {
      setManifestProps([])
      return
    }
    // Read manifest to get prop schemas
    const manifestRelPath = selectedWidget.manifestPath
    const fullPath = currentScene.path + '/' + manifestRelPath
    window.dimensions.readFile(fullPath).then((content: string) => {
      try {
        const manifest = JSON.parse(content)
        setManifestProps(manifest.props || [])
      } catch {
        setManifestProps([])
      }
    }).catch(() => setManifestProps([]))
  }, [selectedWidgetId, selectedWidget?.manifestPath, currentScene?.path])

  return (
    <div className={cn('h-full overflow-y-auto p-[var(--space-lg)]')}>
      {selectedWidget ? (
        <div>
          <h3 className={cn(
            'text-[var(--text-sm)] font-medium mb-[var(--space-md)]',
            'text-[var(--color-text-primary)]',
          )}>
            {selectedWidget.widgetType}
          </h3>

          {/* Props editor */}
          {manifestProps.length > 0 && (
            <div className="space-y-[var(--space-md)] mb-[var(--space-lg)]">
              {manifestProps.map((prop: any) => (
                <PropRow
                  key={prop.key}
                  prop={prop}
                  value={selectedWidget.props?.[prop.key]}
                  defaultValue={prop.default}
                  widgetId={selectedWidget.id}
                />
              ))}
            </div>
          )}

          {/* Widget info */}
          <div className="space-y-[var(--space-sm)] pt-[var(--space-md)] border-t border-[var(--color-border-subtle)]">
            <div className="flex justify-between text-[var(--text-xs)]">
              <span className="text-[var(--color-text-muted)]">ID</span>
              <span className="font-mono text-[var(--color-text-secondary)] truncate ml-2 max-w-[180px]">{selectedWidget.id}</span>
            </div>
            {selectedWidget.bounds && (
              <>
                <div className="flex justify-between text-[var(--text-xs)]">
                  <span className="text-[var(--color-text-muted)]">Position</span>
                  <span className="font-mono text-[var(--color-text-secondary)]">
                    {selectedWidget.bounds.x}, {selectedWidget.bounds.y}
                  </span>
                </div>
                <div className="flex justify-between text-[var(--text-xs)]">
                  <span className="text-[var(--color-text-muted)]">Size</span>
                  <span className="font-mono text-[var(--color-text-secondary)]">
                    {selectedWidget.bounds.width} × {selectedWidget.bounds.height}
                  </span>
                </div>
              </>
            )}
          </div>
        </div>
      ) : (
        <div className="text-center pt-[var(--space-2xl)]">
          <p className="text-[var(--text-sm)] text-[var(--color-text-muted)]">
            Select a widget to view properties
          </p>
        </div>
      )}

      {currentScene && (
        <div className="mt-[var(--space-2xl)] pt-[var(--space-lg)] border-t border-[var(--color-border-subtle)]">
          <h3 className={cn(
            'text-[var(--text-sm)] font-medium mb-[var(--space-md)]',
            'text-[var(--color-text-primary)]',
          )}>
            Scene
          </h3>
          <div className="space-y-[var(--space-sm)]">
            <div className="flex justify-between text-[var(--text-xs)]">
              <span className="text-[var(--color-text-muted)]">Title</span>
              <span className="text-[var(--color-text-secondary)]">{currentScene.title}</span>
            </div>
            <div className="flex justify-between text-[var(--text-xs)]">
              <span className="text-[var(--color-text-muted)]">Widgets</span>
              <span className="text-[var(--color-text-secondary)]">{currentScene.widgets?.length ?? 0}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
