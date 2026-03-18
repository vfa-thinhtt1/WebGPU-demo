import { useEffect, useRef, useState } from "react"
import { useWebGPU } from "./WebGPUContext.jsx"
import {
  DemoShell,
  configureCanvasSize,
  fullscreenPipeline,
  startLoop,
  usePointer,
} from "./webgpuCommon.jsx"

export default function CyberMatrixDemo() {
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
          context = canvas.getContext("webgpu")
          context.configure({ device, format, alphaMode: "premultiplied" })

          if (cancelled) { context.unconfigure(); return }

          const uniformBuffer = device.createBuffer({
            size: 4 * 8,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
          })

          const pipeline = fullscreenPipeline({
            device,
            format,
            fragmentCode: /* wgsl */ `
struct U {
  time: f32,
  w: f32,
  h: f32,
  mx: f32,
  my: f32,
  mdx: f32,
  mdy: f32,
  down: f32,
};
@group(0) @binding(0) var<uniform> u: U;

fn hash(p: vec2f) -> f32 {
  return fract(sin(dot(p, vec2f(12.9898,78.233))) * 43758.5453);
}

fn char(p: vec2f, id: f32) -> f32 {
  let grid = floor(p);
  let f = fract(p);
  let h = hash(grid + id);
  
  if (h > 0.5) { return 0.0; } // density
  
  // Fake character generation
  let sdf = abs(f.x - 0.5) + abs(f.y - 0.5) - 0.3;
  let line = step(0.1, abs(sin(f.x * 10.0 + h * 6.28)));
  return (1.0 - smoothstep(0.0, 0.1, sdf)) * line;
}

@fragment
fn fsMain(@location(0) uv: vec2f) -> @location(0) vec4f {
  let t = u.time * 0.8;
  let aspect = u.w / u.h;
  var p = uv * vec2f(30.0 * aspect, 30.0);
  
  let grid = floor(p);
  let m = vec2f(u.mx * aspect * 30.0, u.my * 30.0);
  let dist = length(grid - m);
  
  // Column speed variation
  let colId = floor(p.x);
  let speed = 2.0 + hash(vec2f(colId, 0.0)) * 5.0;
  p.y += t * speed;
  
  let val = char(p, colId);
  
  // Tail fade
  let tail = fract(-p.y * 0.1 + hash(vec2f(colId, 1.0)));
  
  var col = vec3f(0.0, 1.0, 0.2) * val * tail;
  
  // Bright head
  if (tail > 0.95) {
     col += vec3f(0.8, 1.0, 0.9) * val;
  }
  
  // Glitch
  let glitch = step(0.995, hash(vec2f(t, grid.y)));
  col = mix(col, vec3f(1.0, 0.2, 0.1), glitch * 0.5);
  
  // Glow near mouse
  col += vec3f(0.0, 0.5, 1.0) * exp(-dist * 0.5) * (1.0 + u.down * 4.0);

  // Gamma
  col = pow(col, vec3f(1.0/2.2));
  
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
              ptr.x, 1 - ptr.y, ptr.dx, -ptr.dy, ptr.down ? 1 : 0,
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
      title="Cyber Matrix Rain"
      hint="Watch the digital rain fall. Move mouse to attract blue energy."
      error={error ?? gpuError}
    >
      <canvas ref={canvasRef} width={1920} height={1080} style={{ width: '100%', height: '100%', display: 'block' }} className="demo-canvas" />
    </DemoShell>
  )
}
