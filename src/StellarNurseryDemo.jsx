import { useEffect, useRef, useState } from "react"
import { useWebGPU } from "./WebGPUContext.jsx"
import {
  DemoShell,
  configureCanvasSize,
  fullscreenPipeline,
  startLoop,
  usePointer,
} from "./webgpuCommon.jsx"

export default function StellarNurseryDemo() {
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
    pp *= 2.1;
    a *= 0.5;
  }
  return v;
}

@fragment
fn fsMain(@location(0) uv: vec2f) -> @location(0) vec4f {
  let t = u.time * 0.2;
  let aspect = u.w / u.h;
  let p = (uv - 0.5) * vec2f(aspect, 1.0);
  let m = (vec2f(u.mx, 1.0 - u.my) - 0.5) * vec2f(aspect, 1.0);
  
  // Volumetric nebula layers
  var col = vec3f(0.01, 0.0, 0.05);
  
  for(var i=1.0; i<=3.0; i+=1.0) {
    let zoom = i * 2.0;
    let shift = vec2f(t * 0.1 * i, t * 0.05 * (4.0-i));
    let n = fbm(p * zoom + shift);
    
    let nebCol = mix(vec3f(0.1, 0.2, 0.8), vec3f(0.8, 0.1, 0.6), n);
    col += nebCol * pow(n, 3.0) * (0.5 / i);
  }
  
  // Stars
  for(var i=0.0; i<10.0; i+=1.0) {
    let starId = i + 123.45;
    let pos = vec2f(hash(vec2f(starId, 1.0)) - 0.5, hash(vec2f(starId, 2.0)) - 0.5) * vec2f(aspect, 1.0);
    let dist = length(p - pos);
    let size = 0.002 + 0.002 * sin(t * 2.0 + i);
    let pulse = 0.5 + 0.5 * sin(t * 5.0 + i);
    
    col += vec3f(1.0, 0.9, 0.7) * (size / (dist + 0.001)) * pulse;
  }
  
  // Interactive "Protostar"
  let mdist = length(p - m);
  let protostar = (0.01 + u.down * 0.05) / (mdist + 0.01);
  col += vec3f(1.0, 0.6, 0.1) * protostar;
  
  // Post-processing
  col = mix(col, col * col, 0.3); // contrast
  col = col / (col + vec3f(0.5)); // tone map
  col = pow(max(col, vec3f(0.0)), vec3f(1.0/2.2)); // gamma
  
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
      title="Stellar Nursery"
      hint="Watch stars being born in the nebula. Click to ignite a massive protostar."
      error={error ?? gpuError}
    >
      <canvas ref={canvasRef} width={1920} height={1080} style={{ width: '100%', height: '100%', display: 'block' }} className="demo-canvas" />
    </DemoShell>
  )
}
