import { cn } from '@/lib/utils'
import { useEffect } from 'react'

interface DownloadRequest {
  downloadId: string
  filename: string
  fileSize: number
  sourceUrl: string
  mimeType: string
}

function getFileIcon(mimeType: string): string {
  if (mimeType.startsWith('image/')) return '\u{1F5BC}'
  if (mimeType.startsWith('video/')) return '\u{1F3AC}'
  if (mimeType.startsWith('audio/')) return '\u{1F3B5}'
  if (mimeType.includes('pdf')) return '\u{1F4C4}'
  if (mimeType.includes('zip') || mimeType.includes('tar') || mimeType.includes('rar')) return '\u{1F4E6}'
  return '\u{1F4CE}'
}

function formatFileSize(bytes: number): string {
  if (bytes <= 0) return 'Unknown size'
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
  return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB'
}

export function DownloadConfirmModal({ request, onClose }: {
  request: DownloadRequest
  onClose: () => void
}) {
  const domain = (() => {
    try { return new URL(request.sourceUrl).hostname } catch { return 'unknown' }
  })()

  const handleAccept = () => {
    window.dimensions.acceptDownload(request.downloadId)
    onClose()
  }

  const handleCancel = () => {
    window.dimensions.cancelDownload(request.downloadId)
    onClose()
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') handleCancel() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50"
      onClick={handleCancel}
    >
      <div
        className={cn(
          'bg-[var(--color-bg-elevated)] border border-[var(--color-border)]',
          'rounded-[var(--radius-lg)] p-6 max-w-md w-full shadow-2xl',
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-[var(--text-lg)] font-semibold text-[var(--color-text-primary)] mb-0.5">
          Download File
        </h3>
        <p className="text-[var(--text-xs)] text-[var(--color-text-muted)] mb-4">
          from {domain}
        </p>

        <div className={cn(
          'flex items-center gap-3 mb-5 p-3 rounded-[var(--radius-md)]',
          'bg-[var(--color-bg-secondary)] border border-[var(--color-border-subtle)]',
        )}>
          <div className="text-2xl">{getFileIcon(request.mimeType)}</div>
          <div className="flex-1 min-w-0">
            <div className="text-[var(--text-sm)] text-[var(--color-text-primary)] font-medium truncate">
              {request.filename}
            </div>
            <div className="text-[var(--text-xs)] text-[var(--color-text-muted)]">
              {formatFileSize(request.fileSize)}
            </div>
          </div>
        </div>

        <div className="flex gap-2 justify-end">
          <button
            onClick={handleCancel}
            className={cn(
              'px-4 py-2 rounded-[var(--radius-md)]',
              'text-[var(--text-sm)] text-[var(--color-text-secondary)]',
              'hover:bg-[var(--color-bg-secondary)] transition-colors',
            )}
          >
            Cancel
          </button>
          <button
            onClick={handleAccept}
            className={cn(
              'px-4 py-2 rounded-[var(--radius-md)]',
              'text-[var(--text-sm)] font-medium',
              'bg-[var(--color-accent)] text-white hover:opacity-90 transition-opacity',
            )}
          >
            Save to Downloads
          </button>
        </div>

        <p className="text-[10px] text-[var(--color-text-muted)] mt-3 text-center">
          Downloads from webportals require your confirmation for security.
        </p>
      </div>
    </div>
  )
}

export type { DownloadRequest }
