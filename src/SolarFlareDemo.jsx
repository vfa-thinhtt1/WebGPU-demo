import { useEffect, useRef, useState } from "react"
import { useWebGPU } from "./WebGPUContext.jsx"
import {
  DemoShell,
  configureCanvasSize,
  fullscreenPipeline,
  startLoop,
  usePointer,
} from "./webgpuCommon.jsx"

export default function SolarFlareDemo() {
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
  var q = fract(p * vec2f(127.1, 311.7));
  q += dot(q, q + 19.19);
  return fract(q.x * q.y);
}

fn noise(p: vec2f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f*f*(3.0-2.0*f);
  return mix(mix(hash(i), hash(i+vec2f(1.0,0.0)), u.x),
             mix(hash(i+vec2f(0.0,1.0)), hash(i+vec2f(1.0,1.0)), u.x), u.y);
}

fn fbm(p: vec2f) -> f32 {
  var v = 0.0;
  var a = 0.5;
  var pp = p;
  for(var i=0;i<6;i++){
    v += a*noise(pp);
    pp *= 2.0;
    a *= 0.5;
  }
  return v;
}

@fragment
fn fsMain(@location(0) uv: vec2f) -> @location(0) vec4f {
  let t = u.time * 0.5;
  let aspect = u.w / u.h;
  let p = (uv - 0.5) * vec2f(aspect, 1.0);
  let m = (vec2f(u.mx, 1.0 - u.my) - 0.5) * vec2f(aspect, 1.0);
  
  // Turbulent plasma
  let d = length(p);
  let plasma = fbm(p * 3.0 + t * 0.2 + fbm(p * 5.0 - t * 0.5));
  
  var col = vec3f(0.05, 0.01, 0.0);
  
  // Solar body
  let body = smoothstep(0.4, 0.35, d);
  let bodyCol = mix(vec3f(1.0, 0.4, 0.0), vec3f(1.0, 0.9, 0.2), plasma);
  col += bodyCol * body;
  
  // Sunspots
  let spot = smoothstep(0.7, 0.8, fbm(p * 15.0 + t * 0.1)) * body;
  col = mix(col, vec3f(0.1, 0.02, 0.0), spot);
  
  // Corona/Flares
  let corona = (0.2 + plasma * 0.3) / (pow(max(d - 0.35, 0.01), 1.2));
  col += vec3f(1.0, 0.25, 0.05) * corona * (1.0 - body);
  
  // Interactive Eruption
  let mdist = length(p - m);
  let eruption = (0.02 + u.down * 0.08) / (mdist + 0.01);
  col += vec3f(1.0, 0.8, 0.3) * eruption * bodyCol;

  // Gamma and post
  col = col / (col + vec3f(0.5));
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
              ptr.x, ptr.y, ptr.dx, ptr.dy, ptr.down ? 1 : 0,
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
      title="Solar Flare"
      hint="Feel the heat of the stellar surface. Click to trigger a massive solar eruption."
      error={error ?? gpuError}
    >
      <canvas ref={canvasRef} width={1920} height={1080} style={{ width: '100%', height: '100%', display: 'block' }} className="demo-canvas" />
    </DemoShell>
  )
}
