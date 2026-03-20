import { useEffect, useRef, useState } from 'react'
import { clamp01, configureCanvasSize } from './webgpuUtils.js'

export function FPSStats() {
  const [fps, setFps] = useState(0)
  const frameCount = useRef(0)
  const lastTime = useRef(performance.now())

  useEffect(() => {
    let frameId
    const update = () => {
      frameCount.current++
      const now = performance.now()
      if (now - lastTime.current >= 1000) {
        setFps(Math.round((frameCount.current * 1000) / (now - lastTime.current)))
        frameCount.current = 0
        lastTime.current = now
      }
      frameId = requestAnimationFrame(update)
    }
    frameId = requestAnimationFrame(update)
    return () => cancelAnimationFrame(frameId)
  }, [])

  return (
    <div className="fps-counter">
      {fps} FPS
    </div>
  )
}

export function startLoop(callback) {
  let frameId = 0
  let running = true
  const startTime = performance.now()

  const frame = (time) => {
    if (!running) return
    callback((time - startTime) / 1000)
    frameId = requestAnimationFrame(frame)
  }

  frameId = requestAnimationFrame(frame)
  return () => {
    running = false
    cancelAnimationFrame(frameId)
  }
}

export function usePointer(canvasRef) {
  const ref = useRef({ x: 0.5, y: 0.5, dx: 0, dy: 0, down: false })

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const getXY = (e) => {
      const r = canvas.getBoundingClientRect()
      return {
        x: clamp01((e.clientX - r.left) / Math.max(1, r.width)),
        y: clamp01((e.clientY - r.top) / Math.max(1, r.height)),
      }
    }

    const onMove = (e) => {
      const p = ref.current
      const { x, y } = getXY(e)
      p.dx = x - p.x
      p.dy = y - p.y
      p.x = x
      p.y = y
    }

    const onDown = (e) => {
      ref.current.down = true
      onMove(e)
    }
    const onUp = () => {
      ref.current.down = false
    }

    canvas.addEventListener('pointermove', onMove)
    canvas.addEventListener('pointerdown', onDown)
    window.addEventListener('pointerup', onUp)

    return () => {
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointerup', onUp)
    }
  }, [canvasRef])

  return ref
}

export function DemoShell({ title, hint, error, children, extra }) {
  return (
    <div className="demo">
      <div className="demo-info">
        <h2>{title}</h2>
        {hint && <p className="demo-caption">{hint}</p>}
      </div>
      {extra}
      {error && <p className="error">{error}</p>}
      {children}
    </div>
  )
}

export function fullscreenPipeline({ device, format, fragmentCode }) {
  const module = device.createShaderModule({
    code: /* wgsl */ `
      struct VSOut { @builtin(position) pos: vec4f, @location(0) uv: vec2f };
      @vertex fn vsMain(@builtin(vertex_index) i: u32) -> VSOut {
        var p = array<vec2f, 6>(
          vec2f(-1.0, -1.0), vec2f( 1.0, -1.0), vec2f(-1.0,  1.0),
          vec2f(-1.0,  1.0), vec2f( 1.0, -1.0), vec2f( 1.0,  1.0)
        );
        let pos = p[i];
        var o: VSOut;
        o.pos = vec4f(pos, 0.0, 1.0);
        o.uv = pos * 0.5 + 0.5;
        return o;
      }
      ${fragmentCode}
    `,
  })

  return device.createRenderPipeline({
    layout: 'auto',
    vertex: { module, entryPoint: 'vsMain' },
    fragment: { module, entryPoint: 'fsMain', targets: [{ format }] },
    primitive: { topology: 'triangle-list' },
  })
}

export { configureCanvasSize }

