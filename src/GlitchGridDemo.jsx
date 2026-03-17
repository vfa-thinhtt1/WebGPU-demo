import { useEffect, useRef, useState } from "react"
import { useWebGPU } from "./WebGPUContext.jsx"
import {
  DemoShell,
  configureCanvasSize,
  fullscreenPipeline,
  startLoop,
  usePointer,
} from "./webgpuCommon.jsx"

export default function GlitchGridDemo() {
  const canvasRef = useRef(null)
  const pointerRef = usePointer(canvasRef)
  const { gpuState, error: gpuError } = useWebGPU()
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!gpuState) return

    const { device, format } = gpuState
    const canvas = canvasRef.current
    if (!canvas) return

    let cancelled = false
    let stop = () => { }
    let context = null

      ; (async () => {
        try {
          context = canvas.getContext('webgpu')
          context.configure({ device, format, alphaMode: 'premultiplied' })

          if (cancelled) { context.unconfigure(); return }

          const uniformBuffer = device.createBuffer({
            size: 32, // time, w, h, mx, my, mdx, mdy, down
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
          })

          const pipeline = fullscreenPipeline({
            device,
            format,
            fragmentCode: /* wgsl */ `
            struct U {
              time : f32,
              w    : f32,
              h    : f32,
              mx   : f32,
              my   : f32,
              mdx  : f32,
              mdy  : f32,
              down : f32,
            };
            @group(0) @binding(0) var<uniform> u: U;

            fn hash21(p: vec2f) -> f32 {
              let q = fract(p * vec2f(123.34, 456.21));
              return fract(dot(q, q + 45.32));
            }

            fn glitch(uv: vec2f, t: f32) -> vec2f {
                var p = uv;
                let strength = 0.02 + 0.1 * u.down;
                if (hash21(vec2f(floor(uv.y * 15.0), floor(t * 10.0))) > 0.8) {
                    p.x += (hash21(vec2f(t)) - 0.5) * strength;
                }
                return p;
            }

            @fragment
            fn fsMain(@location(0) uv: vec2f) -> @location(0) vec4f {
                let t = u.time;
                let g_uv = glitch(uv, t);
                
                // Grid logic
                let grid_size = 15.0;
                let cell_uv = fract(g_uv * grid_size);
                let cell_id = floor(g_uv * grid_size);
                
                let h = hash21(cell_id);
                var mask = 0.0;
                
                if (h > 0.7) {
                    let pattern_t = t * (0.5 + h);
                    let shape = step(0.1, cell_uv.x) * step(0.1, cell_uv.y) * 
                                step(cell_uv.x, 0.9) * step(cell_uv.y, 0.9);
                    mask = shape * step(fract(pattern_t + h), 0.2);
                } else if (h > 0.4) {
                    mask = step(fract(uv.x * 100.0 + t), 0.1) * step(fract(uv.y * 2.0 - t * 0.5), 0.05);
                }
                
                // RGB Split / Chromatic Aberration
                let r = hash21(cell_id + vec2f(0.01)) * mask;
                let g = hash21(cell_id) * mask;
                let b = hash21(cell_id - vec2f(0.01)) * mask;
                
                var col = vec3f(r, g, b);
                
                // Mouse light
                let d = distance(uv, vec2f(u.mx, 1.0 - u.my));
                col += vec3f(0.5, 0.2, 1.0) * exp(-d * 10.0) * 0.3;
                
                // Scanning lines
                col *= 0.8 + 0.2 * sin(uv.y * 800.0 + t * 10.0);
                
                // Glow
                let glow = smoothstep(0.4, 0.0, abs(fract(uv.x * 2.0 + t * 0.2) - 0.5));
                col += vec3f(0.0, 0.5, 1.0) * glow * 0.1;

                return vec4f(col, 1.0);
            }
            `,
          })

          const bindGroup = device.createBindGroup({
            layout: pipeline.getBindGroupLayout(0),
            entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
          })

          const onResize = () => configureCanvasSize(canvas, context, device, format)
          onResize()
          window.addEventListener("resize", onResize)

          stop = startLoop((time) => {
            const ptr = pointerRef.current
            const { width, height } = configureCanvasSize(canvas, context, device, format)

            device.queue.writeBuffer(uniformBuffer, 0, new Float32Array([
              time, width, height,
              ptr.x, 1 - ptr.y, ptr.dx, -ptr.dy, ptr.down ? 1 : 0
            ]))

            const encoder = device.createCommandEncoder()
            const pass = encoder.beginRenderPass({
              colorAttachments: [{
                view: context.getCurrentTexture().createView(),
                clearValue: { r: 0, g: 0, b: 0, a: 1 },
                loadOp: "clear", storeOp: "store",
              }],
            })
            pass.setPipeline(pipeline)
            pass.setBindGroup(0, bindGroup)
            pass.draw(6)
            pass.end()
            device.queue.submit([encoder.finish()])
          })

          const origStop = stop
          stop = () => {
            origStop()
            window.removeEventListener("resize", onResize)
          }
        } catch (e) {
          console.error(e)
          setError(e?.message ?? String(e))
        }
      })()

    return () => {
      cancelled = true
      stop()
      try { context?.unconfigure() } catch (_) { }
    }
  }, [gpuState, pointerRef])

  return (
    <DemoShell
      title="Glitch Grid"
      hint="Rhythmic digital patterns and chromatic aberration. Click to increase glitch intensity."
      error={error ?? gpuError}
    >
      <canvas ref={canvasRef} width={1920} height={1080} style={{ width: '100%', height: '100%', display: 'block' }} className="demo-canvas" />
    </DemoShell>
  )
}
