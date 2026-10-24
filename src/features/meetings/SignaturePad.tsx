import { Box, Button, Group, Stack, Text } from '@mantine/core'
import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { he } from '../../lib/he'
import { canvasToPng } from './canvas'

const S = he.meetings.sign
const HEIGHT = 180

function setup(canvas: HTMLCanvasElement): CanvasRenderingContext2D | null {
  const ratio = window.devicePixelRatio || 1
  const width = canvas.clientWidth || 320
  canvas.width = width * ratio
  canvas.height = HEIGHT * ratio
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
  Object.assign(ctx, { lineWidth: 2.5, lineCap: 'round', lineJoin: 'round', strokeStyle: '#1B2330' })
  return ctx
}

const point = (e: PointerEvent<HTMLCanvasElement>) => {
  const r = e.currentTarget.getBoundingClientRect()
  return { x: e.clientX - r.left, y: e.clientY - r.top }
}

/** Touch or mouse strokes on a canvas. */
function useStrokes() {
  const ref = useRef<HTMLCanvasElement>(null)
  const ctx = useRef<CanvasRenderingContext2D | null>(null)
  const drawing = useRef(false)
  const [inked, setInked] = useState(false)
  useEffect(() => { if (ref.current) ctx.current = setup(ref.current) }, [])
  const down = (e: PointerEvent<HTMLCanvasElement>) => {
    drawing.current = true
    e.currentTarget.setPointerCapture?.(e.pointerId)
    const p = point(e)
    ctx.current?.beginPath()
    ctx.current?.moveTo(p.x, p.y)
  }
  const move = (e: PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current || !ctx.current) return
    const p = point(e)
    ctx.current.lineTo(p.x, p.y)
    ctx.current.stroke()
    setInked(true)
  }
  const up = () => { drawing.current = false }
  const clear = () => {
    const c = ref.current
    if (c) ctx.current?.clearRect(0, 0, c.width, c.height)
    setInked(false)
  }
  return { ref, inked, clear, handlers: { onPointerDown: down, onPointerMove: move, onPointerUp: up, onPointerLeave: up } }
}

/** "חתימה בציור": draw, clear, save (a PNG blob for the private bucket). */
export function SignaturePad({ onSave, saving }: { onSave: (png: Blob) => void; saving: boolean }) {
  const { ref: canvasRef, inked, clear, handlers } = useStrokes()
  const [tried, setTried] = useState(false)
  const save = async () => {
    setTried(true)
    if (inked && canvasRef.current) onSave(await canvasToPng(canvasRef.current))
  }
  return (
    <Stack gap="xs">
      <Text size="sm" c="dimmed">{S.padHint}</Text>
      <Box style={{ border: '1px dashed var(--mantine-color-stone-4)', borderRadius: 10, background: '#fff' }}>
        <canvas ref={canvasRef} role="img" aria-label={S.pad} height={HEIGHT}
          style={{ width: '100%', height: HEIGHT, display: 'block', touchAction: 'none', cursor: 'crosshair' }} {...handlers} />
      </Box>
      {tried && !inked && <Text c="debt.7" size="sm" role="alert">{S.empty}</Text>}
      <Group justify="space-between" gap="sm">
        <Button variant="subtle" color="stone.7" onClick={clear}>{S.clear}</Button>
        <Button onClick={() => void save()} loading={saving}>{S.save}</Button>
      </Group>
    </Stack>
  )
}
