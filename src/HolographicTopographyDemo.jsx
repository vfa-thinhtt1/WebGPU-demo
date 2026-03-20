import { useEffect, useRef, useState } from "react"
import { useWebGPU } from "./WebGPUContext.jsx"
import { DemoShell, configureCanvasSize, fullscreenPipeline, startLoop, usePointer } from "./webgpuCommon.jsx"

export default function HolographicTopographyDemo() {
  const canvasRef  = useRef(null)
  const pointerRef = usePointer(canvasRef)
  const { gpuState, error: gpuError } = useWebGPU()
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!gpuState) return

    const { device, format } = gpuState
    const canvas = canvasRef.current
    if (!canvas) return

    let cancelled = false
    let stop    = () => {}
    let context = null

    ;(async () => {
      try {
        context = canvas.getContext('webgpu')
        context.configure({ device, format, alphaMode: 'premultiplied' })

        if (cancelled) { context.unconfigure(); return }

        const uniformBuffer = device.createBuffer({
          size: 4 * 8,
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        })

        const pipeline = fullscreenPipeline({
          device,
          format,
          fragmentCode: /* wgsl */`

struct Uniforms {
  time:f32,
  w:f32,
  h:f32,
  mx:f32,
  my:f32,
  mdx:f32,
  mdy:f32,
  down:f32
};

@group(0) @binding(0) var<uniform> u: Uniforms;

fn hash21(p: vec2f) -> f32 {
    let q = fract(p * vec2f(123.34, 456.21));
    return fract(dot(q, q + 45.32));
}

fn noise(p: vec2f) -> f32 {
    let i = floor(p);
    let f = fract(p);
    let uv = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash21(i + vec2f(0.0, 0.0)),
                   hash21(i + vec2f(1.0, 0.0)), uv.x),
               mix(hash21(i + vec2f(0.0, 1.0)),
                   hash21(i + vec2f(1.0, 1.0)), uv.x), uv.y);
}

fn fbm(p: vec2f) -> f32 {
    var v = 0.0;
    var a = 0.5;
    var shift = vec2f(100.0);
    var pos = p;
    let rot = mat2x2<f32>(cos(0.5), sin(0.5), -sin(0.5), cos(0.5));
    for (var i = 0; i < 5; i++) {
        v += a * noise(pos);
        pos = rot * pos * 2.0 + shift;
        a *= 0.5;
    }
    return v;
}

fn map(p: vec3f) -> f32 {
    let h = fbm(p.xz * 0.5 + u.time * vec2f(0.0, 0.5)) * 2.0;
    return p.y + h;
}

@fragment
fn fsMain(@location(0) uv: vec2f) -> @location(0) vec4f {
    let aspect = u.w / u.h;
    var p = (uv - 0.5) * vec2f(aspect, 1.0);
    
    let mouse = (vec2f(u.mx, u.my) - 0.5) * vec2f(aspect, 1.0);
    p += mouse * 0.5;
    
    let ro = vec3f(0.0, 2.0, -5.0 + u.time * 2.0);
    let rd = normalize(vec3f(p, 1.0));
    
    var t = 0.0;
    var hit = false;
    for (var i = 0; i < 80; i++) {
        let pos = ro + rd * t;
        let d = map(pos);
        if (d < 0.01) { hit = true; break; }
        if (t > 20.0) { break; }
        t += d * 0.5;
    }
    
    var col = vec3f(0.0, 0.0, 0.0);
    if (hit) {
        let pos = ro + rd * t;
        let h = fbm(pos.xz * 0.5 + u.time * vec2f(0.0, 0.5));
        
        let grid = abs(fract(pos.xz * 2.0) - 0.5);
        let line = smoothstep(0.45, 0.5, max(grid.x, grid.y));
        
        let glow = exp(-pos.y * 2.5);
        col = mix(vec3f(0.0, 0.2, 0.5), vec3f(0.0, 1.0, 0.8), h) * line * glow;
        
        // Add sweeping scanner horizon
        let scanner = smoothstep(0.9, 1.0, sin(pos.z * 0.5 - u.time * 5.0));
        col += vec3f(0.0, 1.0, 0.5) * scanner * 0.5 * line;
    }
    
    let fog = exp(-t * 0.15);
    
    return vec4f(col * fog, 1.0);
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
          const p = pointerRef.current
          const { width, height } = configureCanvasSize(canvas, context, device, format)

          device.queue.writeBuffer(uniformBuffer, 0, new Float32Array([
            time, width, height,
            p.x, 1 - p.y, p.dx, -p.dy, p.down ? 1 : 0,
          ]))

          const encoder = device.createCommandEncoder()
          const pass = encoder.beginRenderPass({
            colorAttachments: [{
              view: context.getCurrentTexture().createView(),
              clearValue: { r: 0, g: 0, b: 0, a: 1 },
              loadOp: "clear",
              storeOp: "store",
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
      try { context?.unconfigure() } catch (_) {}
    }
  }, [gpuState, pointerRef])

  return (
    <DemoShell
      title="Holographic Topography"
      hint="Move mouse to explore the grid."
      error={error ?? gpuError}
    >
      <canvas ref={canvasRef} width={1920} height={1080} style={{width:'100%',height:'100%',display:'block'}} className="demo-canvas" />
    </DemoShell>
  )
}
