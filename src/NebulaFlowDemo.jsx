import { useEffect, useRef, useState } from "react"
import { useWebGPU } from "./WebGPUContext.jsx"
import {
  DemoShell,
  configureCanvasSize,
  fullscreenPipeline,
  startLoop,
  usePointer,
} from "./webgpuCommon.jsx"

export default function NebulaFlowDemo() {
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
            size: 4 * 8,
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

fn hash(p: vec2f) -> f32 {
    let q = fract(p * vec2f(123.34, 456.21));
    return fract(dot(q, q + 45.32));
}

fn noise(p: vec2f) -> f32 {
    let i = floor(p);
    let f = fract(p);
    let u2 = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i + vec2f(0.0, 0.0)), 
                   hash(i + vec2f(1.0, 0.0)), u2.x),
               mix(hash(i + vec2f(0.0, 1.0)), 
                   hash(i + vec2f(1.0, 1.0)), u2.x), u2.y);
}

fn fbm(p: vec2f) -> f32 {
    var v = 0.0;
    var a = 0.5;
    var pos = p;
    for (var i = 0; i < 5; i++) {
        v += a * noise(pos);
        pos *= 2.0;
        a *= 0.5;
    }
    return v;
}

fn palette(t: f32) -> vec3f {
    let a = vec3f(0.5, 0.5, 0.5);
    let b = vec3f(0.5, 0.5, 0.5);
    let c = vec3f(1.0, 1.0, 1.0);
    let d = vec3f(0.263, 0.416, 0.557);
    return a + b * cos(6.28318 * (c * t + d));
}

@fragment
fn fsMain(@location(0) uv: vec2f) -> @location(0) vec4f {
    let aspect = u.w / u.h;
    var p = (uv - 0.5) * vec2f(aspect, 1.0);
    let m = (vec2f(u.mx, u.my) - 0.5) * vec2f(aspect, 1.0);
    
    let dist = length(p - m);
    let force = exp(-dist * 8.0) * (u.down * 0.5 + 0.1);
    p += (p - m) * force;

    let t = u.time * 0.15;
    
    // Domain warping
    let q = vec2f(fbm(p + vec2f(0.0, 0.0) + t), fbm(p + vec2f(5.2, 1.3) + t));
    let r = vec2f(fbm(p + 4.0 * q + vec2f(1.7, 9.2) + t * 0.5), fbm(p + 4.0 * q + vec2f(8.3, 2.8) + t * 0.3));
    
    let f = fbm(p + 4.0 * r);
    
    var col = palette(f + dist * 0.2);
    col *= f * f * (3.0 - 2.0 * f);
    col += mix(col, vec3f(0.1, 0.2, 0.5), dot(q, q));
    col = mix(col, vec3f(0.7, 0.2, 0.1), 0.5 * r.y * r.y);
    
    // Lens flare-like glow
    col += vec3f(0.2, 0.4, 1.0) * exp(-dist * dist * 30.0) * 0.8;
    
    // Vignette
    let vignette = smoothstep(0.8, 0.2, length(uv - 0.5));
    col *= vignette;

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
      title="Nebula Flow"
      hint="Move mouse to warp the nebula. Click for more turbulence."
      error={error ?? gpuError}
    >
      <canvas ref={canvasRef} width={1920} height={1080} style={{ width: '100%', height: '100%', display: 'block' }} className="demo-canvas" />
    </DemoShell>
  )
}
