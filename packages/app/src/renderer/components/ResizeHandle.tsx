import { useCallback, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

interface ResizeHandleProps {
  side: 'left' | 'right'
  onResize: (delta: number) => void
  onResizeEnd?: () => void
}

export function ResizeHandle({ side, onResize, onResizeEnd }: ResizeHandleProps) {
  const [dragging, setDragging] = useState(false)
  const startXRef = useRef(0)

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault()
    const target = e.currentTarget as HTMLElement
    target.setPointerCapture(e.pointerId)
    startXRef.current = e.clientX
    setDragging(true)

    const onMove = (ev: PointerEvent) => {
      const delta = ev.clientX - startXRef.current
      startXRef.current = ev.clientX
      onResize(side === 'left' ? delta : -delta)
    }

    const onUp = (ev: PointerEvent) => {
      target.releasePointerCapture(ev.pointerId)
      target.removeEventListener('pointermove', onMove)
      target.removeEventListener('pointerup', onUp)
      setDragging(false)
      onResizeEnd?.()
    }

    target.addEventListener('pointermove', onMove)
    target.addEventListener('pointerup', onUp)
  }, [side, onResize, onResizeEnd])

  return (
    <div
      onPointerDown={onPointerDown}
      className={cn(
        'shrink-0 w-[6px] cursor-col-resize relative touch-none group z-10',
      )}
    >
      {/* Wider invisible hit area */}
      <div className="absolute inset-y-0 -left-[4px] -right-[4px]" />
      {/* Visible indicator line */}
      <div
        className={cn(
          'absolute top-0 bottom-0 left-[2px] w-[2px] rounded-full',
          'transition-colors duration-100',
          dragging
            ? 'bg-[var(--color-accent)]'
            : 'bg-transparent group-hover:bg-[var(--color-accent)] group-hover:opacity-60',
        )}
      />
    </div>
  )
}
