import { cn } from '@/lib/utils'
import { useEffect, useState, useCallback } from 'react'

export interface DownloadRequest {
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

function isMediaType(mimeType: string): boolean {
  return mimeType.startsWith('image/') || mimeType.startsWith('video/') || mimeType.startsWith('audio/')
}

function folderName(p: string): string {
  const parts = p.replace(/\/+$/, '').split('/')
  return parts[parts.length - 1] || 'Downloads'
}

type ModalState = 'confirm' | 'downloading' | 'success'

export function DownloadConfirmModal({ request, onClose }: {
  request: DownloadRequest
  onClose: () => void
}) {
  const [state, setState] = useState<ModalState>('confirm')
  const [successMsg, setSuccessMsg] = useState('')
  const [downloadFolder, setDownloadFolder] = useState<string | null>(null)
  const [filename, setFilename] = useState(request.filename)

  const domain = (() => {
    try { return new URL(request.sourceUrl).hostname } catch { return 'unknown' }
  })()

  const showMediaOption = isMediaType(request.mimeType)

  useEffect(() => {
    window.dimensions.getDownloadFolder?.()?.then?.((f: string) => setDownloadFolder(f)).catch(() => {})
  }, [])

  const displayFolder = downloadFolder ? folderName(downloadFolder) : 'Downloads'

  const showSuccess = useCallback((msg: string) => {
    setSuccessMsg(msg)
    setState('success')
    setTimeout(() => onClose(), 900)
  }, [onClose])

  useEffect(() => {
    const handler = (data: any) => {
      if (data.downloadId !== request.downloadId) return
      if (data.state === 'completed') {
        // Use the actual savePath from main process to show the correct folder
        const folder = data.savePath ? folderName(data.savePath.replace(/\/[^/]+$/, '')) : displayFolder
        showSuccess(data.savedToMedia ? 'Saved to Dimensions' : `Saved to ${folder}`)
      }
    }
    window.dimensions.onDownloadComplete(handler)
  }, [request.downloadId, showSuccess, displayFolder])

  const handleSaveToMedia = () => {
    setState('downloading')
    window.dimensions.acceptDownloadToMedia(request.downloadId, filename)
  }

  const handleSaveToFolder = () => {
    setState('downloading')
    window.dimensions.acceptDownload(request.downloadId, filename)
  }

  const handleChooseFolder = async () => {
    const result = await window.dimensions.chooseDownloadFolder?.()
    if (result) {
      setDownloadFolder(result)
      setState('downloading')
      window.dimensions.acceptDownload(request.downloadId, filename)
    }
  }

  const handleCancel = () => {
    if (state !== 'confirm') return
    window.dimensions.cancelDownload(request.downloadId)
    onClose()
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && state === 'confirm') handleCancel() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [state])

  // ── Success state ──
  if (state === 'success') {
    return (
      <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50">
        <div className={cn(
          'rounded-[var(--radius-lg)] p-6 max-w-md w-full shadow-2xl',
          'flex flex-col items-center gap-3',
          'bg-emerald-950 border border-emerald-700',
          'animate-[fadeIn_150ms_ease-out]',
        )}>
          <div className="w-12 h-12 rounded-full bg-emerald-500 flex items-center justify-center">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          <p className="text-[var(--text-sm)] font-medium text-emerald-200">{successMsg}</p>
        </div>
      </div>
    )
  }

  // ── Downloading state ──
  if (state === 'downloading') {
    return (
      <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50">
        <div className={cn(
          'bg-[var(--color-bg-elevated)] border border-[var(--color-border)]',
          'rounded-[var(--radius-lg)] p-6 max-w-md w-full shadow-2xl',
          'flex flex-col items-center gap-3',
        )}>
          <div className="w-5 h-5 border-2 border-[var(--color-text-muted)] border-t-[var(--color-accent)] rounded-full animate-spin" />
          <p className="text-[var(--text-sm)] text-[var(--color-text-secondary)]">Downloading...</p>
        </div>
      </div>
    )
  }

  // ── Confirm state ──
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

        {/* File info + rename */}
        <div className={cn(
          'mb-5 p-3 rounded-[var(--radius-md)]',
          'bg-[var(--color-bg-secondary)] border border-[var(--color-border-subtle)]',
        )}>
          <div className="flex items-center gap-3">
            <div className="text-2xl">{getFileIcon(request.mimeType)}</div>
            <div className="flex-1 min-w-0">
              <input
                type="text"
                value={filename}
                onChange={(e) => setFilename(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                className={cn(
                  'w-full bg-transparent border-b border-transparent',
                  'text-[var(--text-sm)] text-[var(--color-text-primary)] font-medium',
                  'outline-none',
                  'hover:border-[var(--color-border)] focus:border-[var(--color-accent)]',
                  'transition-colors',
                )}
              />
              <div className="text-[var(--text-xs)] text-[var(--color-text-muted)] mt-0.5">
                {formatFileSize(request.fileSize)}
              </div>
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

          {/* Split button: Save to folder + dropdown to change folder */}
          <div className="flex rounded-[var(--radius-md)] overflow-hidden border border-[var(--color-border)]">
            <button
              onClick={handleSaveToFolder}
              className={cn(
                'px-4 py-2',
                'text-[var(--text-sm)] text-[var(--color-text-primary)]',
                'bg-[var(--color-bg-tertiary)]',
                'hover:bg-[var(--color-bg-hover)] transition-colors',
              )}
            >
              Save to {displayFolder}
            </button>
            <button
              onClick={handleChooseFolder}
              className={cn(
                'px-2 py-2 border-l border-[var(--color-border)]',
                'text-[var(--color-text-muted)]',
                'bg-[var(--color-bg-tertiary)]',
                'hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)] transition-colors',
              )}
              title="Choose a different folder"
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 5l3 3 3-3" />
              </svg>
            </button>
          </div>

          {showMediaOption && (
            <button
              onClick={handleSaveToMedia}
              className={cn(
                'px-4 py-2 rounded-[var(--radius-md)]',
                'text-[var(--text-sm)] font-medium',
                'bg-[var(--color-accent)] text-white hover:opacity-90 transition-opacity',
              )}
            >
              Save to Dimensions
            </button>
          )}
        </div>

        <p className="text-[10px] text-[var(--color-text-muted)] mt-3 text-center">
          Downloads from webportals require your confirmation for security.
        </p>
      </div>
    </div>
  )
}
