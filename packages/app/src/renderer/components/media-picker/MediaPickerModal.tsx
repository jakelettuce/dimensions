import { cn } from '@/lib/utils'
import { useState, useEffect, useCallback } from 'react'
import { X, Upload, Grid3x3, Check } from 'lucide-react'

interface MediaEntry {
  filename: string
  url: string
  meta: {
    originalName: string
    mimeType: string
    size: number
    addedAt: number
  }
}

interface MediaPickerProps {
  open: boolean
  onClose: () => void
  onSelect: (urls: string[]) => void
  accept?: string[]
  maxItems?: number
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function isImage(mime: string) { return mime.startsWith('image/') }
function isVideo(mime: string) { return mime.startsWith('video/') }

/** Simple thumbnail — uses dimensions-asset:// URL directly (corsEnabled on protocol) */
function MediaThumbnail({ url, mimeType, className }: { url: string; mimeType: string; className?: string }) {
  if (isVideo(mimeType)) {
    return <div className={cn('flex items-center justify-center bg-[var(--color-bg-primary)] text-xl', className)}>▶</div>
  }
  if (!isImage(mimeType)) {
    return <div className={cn('flex items-center justify-center bg-[var(--color-bg-primary)] text-lg', className)}>♪</div>
  }
  return <img src={url} className={cn('object-cover', className)} loading="lazy" />
}

export function MediaPickerModal({ open, onClose, onSelect, accept, maxItems = 100 }: MediaPickerProps) {
  const [tab, setTab] = useState<'library' | 'upload'>('library')
  const [entries, setEntries] = useState<MediaEntry[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<{ filename: string; name: string } | null>(null)

  const loadLibrary = useCallback(() => {
    window.dimensions.listMedia(accept).then((items: MediaEntry[]) => {
      setEntries(Array.isArray(items) ? items : [])
    }).catch(() => setEntries([]))
  }, [accept])

  useEffect(() => {
    if (open) {
      window.dimensions.hideWcvs()
      loadLibrary()
      setSelected(new Set())
    }
    return () => {
      if (open) window.dimensions.showWcvs()
    }
  }, [open, loadLibrary])

  const handleClose = () => {
    window.dimensions.showWcvs()
    onClose()
  }

  const handleSelect = () => {
    const urls = entries
      .filter(e => selected.has(e.filename))
      .map(e => e.url)
      .slice(0, maxItems)
    window.dimensions.showWcvs()
    onSelect(urls)
  }

  const toggleSelect = (filename: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(filename)) {
        next.delete(filename)
      } else if (next.size < maxItems) {
        next.add(filename)
      }
      return next
    })
  }

  const handleUpload = async () => {
    setLoading(true)
    try {
      const result = await window.dimensions.addMedia({ accept, multiple: true })
      if ('urls' in result && result.urls.length > 0) {
        loadLibrary()
        // Auto-select newly uploaded files
        const newFilenames = result.urls.map((u: string) => {
          const parts = u.split('/_media/')
          return parts.length > 1 ? parts[parts.length - 1] : u
        })
        setSelected(prev => {
          const next = new Set(prev)
          for (const fn of newFilenames) {
            if (next.size < maxItems) next.add(fn)
          }
          return next
        })
        setTab('library')
      }
    } finally {
      setLoading(false)
    }
  }

  const handleDeleteRequest = (filename: string) => {
    const entry = entries.find(e => e.filename === filename)
    setDeleteConfirm({ filename, name: entry?.meta.originalName || filename })
  }

  const handleDeleteConfirm = async () => {
    if (!deleteConfirm) return
    await window.dimensions.deleteMedia(deleteConfirm.filename)
    setSelected(prev => {
      const next = new Set(prev)
      next.delete(deleteConfirm.filename)
      return next
    })
    setDeleteConfirm(null)
    loadLibrary()
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60" onClick={handleClose} />

      {/* Modal */}
      <div className={cn(
        'relative w-[640px] max-h-[80vh] flex flex-col',
        'bg-[var(--color-bg-secondary)] border border-[var(--color-border)]',
        'rounded-[var(--radius-lg)] shadow-2xl overflow-hidden',
      )}>
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)]">
          <div className="flex gap-1">
            <button
              onClick={() => setTab('library')}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1 rounded-[var(--radius-md)]',
                'text-[var(--text-xs)] font-medium transition-colors',
                tab === 'library'
                  ? 'bg-[var(--color-bg-elevated)] text-[var(--color-text-primary)]'
                  : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]',
              )}
            >
              <Grid3x3 size={12} /> Library
            </button>
            <button
              onClick={() => setTab('upload')}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1 rounded-[var(--radius-md)]',
                'text-[var(--text-xs)] font-medium transition-colors',
                tab === 'upload'
                  ? 'bg-[var(--color-bg-elevated)] text-[var(--color-text-primary)]'
                  : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]',
              )}
            >
              <Upload size={12} /> Upload
            </button>
          </div>
          <button onClick={handleClose} className="text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]">
            <X size={16} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 min-h-[300px]">
          {tab === 'library' && (
            entries.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full gap-2 text-[var(--color-text-muted)]">
                <p className="text-[var(--text-sm)]">No media yet</p>
                <button
                  onClick={() => setTab('upload')}
                  className="text-[var(--text-xs)] text-[var(--color-accent)] hover:underline"
                >
                  Upload some files
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-4 gap-2">
                {entries.map(entry => {
                  const isSelected = selected.has(entry.filename)
                  return (
                    <div
                      key={entry.filename}
                      onClick={() => toggleSelect(entry.filename)}
                      className={cn(
                        'relative group aspect-square rounded-[var(--radius-md)] overflow-hidden cursor-pointer',
                        'border-2 transition-colors',
                        isSelected
                          ? 'border-[var(--color-accent)]'
                          : 'border-transparent hover:border-[var(--color-border)]',
                      )}
                    >
                      <MediaThumbnail
                        url={entry.url}
                        mimeType={entry.meta.mimeType}
                        className="w-full h-full"
                      />

                      {/* Selection check */}
                      {isSelected && (
                        <div className="absolute top-1 right-1 w-5 h-5 rounded-full bg-[var(--color-accent)] flex items-center justify-center">
                          <Check size={12} className="text-white" />
                        </div>
                      )}

                      {/* Info overlay on hover */}
                      <div className="absolute inset-x-0 bottom-0 bg-black/70 px-1.5 py-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <p className="text-[9px] text-white truncate">{entry.meta.originalName}</p>
                        <p className="text-[8px] text-white/60">{formatSize(entry.meta.size)}</p>
                      </div>

                      {/* Delete button */}
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDeleteRequest(entry.filename) }}
                        className="absolute top-1 left-1 w-4 h-4 rounded-full bg-black/60 text-white text-[10px] opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center hover:bg-red-500"
                      >
                        ×
                      </button>
                    </div>
                  )
                })}
              </div>
            )
          )}

          {tab === 'upload' && (
            <div
              onClick={handleUpload}
              className={cn(
                'flex flex-col items-center justify-center h-full gap-3 cursor-pointer',
                'border-2 border-dashed border-[var(--color-border)] rounded-[var(--radius-lg)]',
                'hover:border-[var(--color-accent)] transition-colors',
                'text-[var(--color-text-muted)]',
              )}
            >
              <Upload size={32} />
              <p className="text-[var(--text-sm)]">
                {loading ? 'Importing...' : 'Click to browse files'}
              </p>
              <p className="text-[var(--text-xs)] text-[var(--color-text-muted)]">
                {accept?.join(', ') || 'All media types'}
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-[var(--color-border)]">
          <span className="text-[var(--text-xs)] text-[var(--color-text-muted)]">
            {selected.size > 0 ? `${selected.size} selected` : 'No selection'}
            {maxItems < 100 && ` (max ${maxItems})`}
          </span>
          <div className="flex gap-2">
            <button
              onClick={handleClose}
              className={cn(
                'px-3 py-1 rounded-[var(--radius-md)]',
                'text-[var(--text-xs)] text-[var(--color-text-muted)]',
                'hover:text-[var(--color-text-secondary)] transition-colors',
              )}
            >
              Cancel
            </button>
            <button
              onClick={handleSelect}
              disabled={selected.size === 0}
              className={cn(
                'px-3 py-1 rounded-[var(--radius-md)]',
                'text-[var(--text-xs)] font-medium transition-colors',
                selected.size > 0
                  ? 'bg-[var(--color-accent)] text-white hover:opacity-90'
                  : 'bg-[var(--color-border)] text-[var(--color-text-muted)] cursor-not-allowed',
              )}
            >
              Add Selected
            </button>
          </div>
        </div>
      </div>

      {/* Delete confirmation */}
      {deleteConfirm && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/50 rounded-[var(--radius-lg)]">
          <div className={cn(
            'bg-[var(--color-bg-secondary)] border border-[var(--color-border)]',
            'rounded-[var(--radius-lg)] p-5 max-w-[320px] shadow-xl',
          )}>
            <p className="text-[var(--text-sm)] text-[var(--color-text-primary)] mb-1">Delete media?</p>
            <p className="text-[var(--text-xs)] text-[var(--color-text-muted)] mb-1 truncate">
              {deleteConfirm.name}
            </p>
            <p className="text-[var(--text-xs)] text-[var(--color-text-muted)] mb-4">
              This will remove the file and all references to it across every scene.
            </p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setDeleteConfirm(null)}
                className="px-3 py-1 rounded-[var(--radius-md)] text-[var(--text-xs)] text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteConfirm}
                className="px-3 py-1 rounded-[var(--radius-md)] text-[var(--text-xs)] font-medium bg-red-500/90 text-white hover:bg-red-500"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
