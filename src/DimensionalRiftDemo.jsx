import { useEffect, useRef, useState } from "react"
import { useWebGPU } from "./WebGPUContext.jsx"
import {
  DemoShell,
  configureCanvasSize,
  fullscreenPipeline,
  startLoop,
  usePointer,
} from "./webgpuCommon.jsx"

export default function DimensionalRiftDemo() {
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
  let t = u.time * 0.5;
  let p = uv - 0.5;
  let m = vec2f(u.mx, u.my) - 0.5;
  
  let dist = length(p - m);
  let rift = abs(p.x * cos(t) + p.y * sin(t)) - 0.05 * fbm(uv * 10.0 + t);
  let glow = exp(-abs(rift) * 20.0) * (1.0 + u.down * 4.0);
  
  // Fractured distortion
  let distort = fbm(p * 5.0 + t) * 0.1;
  let sampleUV = uv + distort * glow;
  
  var col = vec3f(0.02, 0.0, 0.05); // deep space
  
  // Rift edges
  let neon1 = vec3f(0.0, 1.0, 1.0); // Cyan
  let neon2 = vec3f(1.0, 0.0, 1.0); // Magenta
  
  let riftCol = mix(neon1, neon2, 0.5 + 0.5 * sin(t + p.x * 5.0));
  col += riftCol * glow;
  
  // Shards
  let shardVal = fbm(uv * 20.0 - t * 0.2);
  let shard = smoothstep(0.7, 0.8, shardVal) * exp(-dist * 5.0);
  col += vec3f(0.8, 0.9, 1.0) * shard * (1.0 + ripple(dist, t));

  // Glitch stripes
  let glitch = step(0.98, hash(vec2f(uv.y * 100.0, t)));
  col += vec3f(0.5, 0.5, 1.0) * glitch * 0.2;

  // Tone map
  col = col / (col + vec3f(1.0)) * 1.5;
  col = pow(max(col, vec3f(0.0)), vec3f(1.0/2.2));
  
  return vec4f(col, 1.0);
}

fn ripple(d: f32, t: f32) -> f32 {
  return sin(d * 50.0 - t * 10.0) * 0.5 + 0.5;
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
      title="Dimensional Rift"
      hint="Move mouse to warp the rift. Click to unleash massive energy."
      error={error ?? gpuError}
    >
      <canvas ref={canvasRef} width={1920} height={1080} style={{ width: '100%', height: '100%', display: 'block' }} className="demo-canvas" />
    </DemoShell>
  )
}
