import { useEffect, useRef, useState } from "react"
import { useWebGPU } from "./WebGPUContext.jsx"
import {
  DemoShell,
  configureCanvasSize,
  fullscreenPipeline,
  startLoop,
  usePointer,
} from "./webgpuCommon.jsx"

export default function MercuryBlobFusionDemo() {
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
            size: 4 * 16, // Increased for more data
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

// ── Surface normal calculation ──────────────────────
fn getNormal(p: vec2f, t: f32) -> vec2f {
  let e = 0.001;
  return normalize(vec2f(
    field(p + vec2f(e, 0.0), t) - field(p - vec2f(e, 0.0), t),
    field(p + vec2f(0.0, e), t) - field(p - vec2f(0.0, e), t)
  ));
}

fn field(p: vec2f, t: f32) -> f32 {
  var f = 0.0;
  let aspect = u.w / u.h;
  
  // Floating blobs
  for(var i=0.0; i<8.0; i+=1.0) {
    let phase = i * 0.785;
    let pos = vec2f(
      cos(t * 0.5 + phase) * 0.3 * aspect,
      sin(t * 0.7 + phase * 2.0) * 0.2
    );
    let d = length(p - pos);
    f += 0.1 / (d * d + 0.01);
  }
  
  // Mouse interaction
  let m = (vec2f(u.mx, 1.0 - u.my) - 0.5) * vec2f(aspect, 1.0);
  let md = length(p - m);
  f += (0.2 + u.down * 0.5) / (md * md + 0.02);
  
  return f;
}

@fragment
fn fsMain(@location(0) uv: vec2f) -> @location(0) vec4f {
  let t = u.time;
  let aspect = u.w / u.h;
  let p = (uv - 0.5) * vec2f(aspect, 1.0);
  
  let f = field(p, t);
  let threshold = 15.0;
  
  var col = vec3f(0.05, 0.05, 0.08); // background
  
  if (f > threshold) {
    let n = getNormal(p, t);
    
    // Fake reflection
    let refl = reflect(vec3f(p, -1.0), vec3f(n, 1.0));
    let env = 0.5 + 0.5 * cos(refl.xy * 5.0 + t);
    
    // Metallic shading
    let lDir = normalize(vec3f(1.0, 1.0, 1.0));
    let diff = max(dot(vec3f(n, 0.5), lDir), 0.0);
    let spec = pow(max(dot(refl, lDir), 0.0), 32.0);
    
    col = vec3f(0.7, 0.7, 0.75) * diff; // base mercury
    col += env * 0.3; // environment
    col += vec3f(1.0) * spec; // highlight
    
    // Edge smoothing
    let edge = smoothstep(threshold, threshold + 2.0, f);
    col *= edge;
  }
  
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
      title="Mercury Blob Fusion"
      hint="Watch the metallic blobs merge. Move mouse to attract them. Click to surge energy."
      error={error ?? gpuError}
    >
      <canvas ref={canvasRef} width={1920} height={1080} style={{ width: '100%', height: '100%', display: 'block' }} className="demo-canvas" />
    </DemoShell>
  )
}
