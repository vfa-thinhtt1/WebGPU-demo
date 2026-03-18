import { useEffect, useRef, useState } from "react"
import { useWebGPU } from "./WebGPUContext.jsx"
import {
  DemoShell,
  configureCanvasSize,
  fullscreenPipeline,
  startLoop,
  usePointer,
} from "./webgpuCommon.jsx"

export default function ShatteredDimensionDemo() {
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

fn voronoi(p: vec2f) -> vec3f {
  let g = floor(p);
  let f = fract(p);
  var res = vec3f(8.0);
  var mId = vec2f(0.0);
  
  for(var y=-1; y<=1; y++) {
    for(var x=-1; x<=1; x++) {
      let b = vec2f(f32(x), f32(y));
      let r = b - f + hash(g + b);
      let d = dot(r,r);
      if(d < res.x) {
        res = vec3f(d, res.x, res.y);
        mId = g + b;
      } else if(d < res.y) {
        res.z = res.y;
        res.y = d;
      }
    }
  }
  return vec3f(sqrt(res.x), sqrt(res.y), hash(mId));
}

@fragment
fn fsMain(@location(0) uv: vec2f) -> @location(0) vec4f {
  let t = u.time * 0.5;
  let aspect = u.w / u.h;
  let p = (uv - 0.5) * vec2f(aspect, 1.0);
  let m = (vec2f(u.mx, 1.0 - u.my) - 0.5) * vec2f(aspect, 1.0);
  
  // Voronoi crack pattern
  let v = voronoi(p * 5.0 + t * 0.1);
  let crack = smoothstep(0.0, 0.05, v.y - v.x);
  
  var col = vec3f(0.0);
  
  // Surface: Pulsing Mirror
  let mirror = 0.4 + 0.1 * sin(t + v.z * 10.0);
  col = vec3f(mirror) * (0.8 + 0.2 * crack);
  
  // Crack edges
  let edge = 1.0 - smoothstep(0.0, 0.02, v.y - v.x);
  col += vec3f(0.0, 1.0, 1.0) * edge * (1.0 + u.down * 4.0);
  
  // Reveal "Void" underneath
  if (edge > 0.5) {
     let voidP = p * 10.0;
     let voidN = hash(floor(voidP) + floor(t));
     col = mix(col, vec3f(0.1, 0.0, 0.2) * voidN, edge);
  }
  
  // Interactive ripple
  let dist = length(p - m);
  let ripple = sin(dist * 20.0 - t * 10.0) * 0.1 * exp(-dist * 5.0);
  col += vec3f(1.0, 0.5, 0.8) * ripple * u.down;

  // Gamma
  col = pow(max(col, vec3f(0.0)), vec3f(1.0/2.2));
  
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
      title="Shattered Dimension"
      hint="Watch the mirror crack. Move mouse to ripple the surface. Click to shatter the reality."
      error={error ?? gpuError}
    >
      <canvas ref={canvasRef} width={1920} height={1080} style={{ width: '100%', height: '100%', display: 'block' }} className="demo-canvas" />
    </DemoShell>
  )
}
