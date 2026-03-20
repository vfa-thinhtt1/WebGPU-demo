import { useEffect, useRef, useState } from "react"
import { useWebGPU } from "./WebGPUContext.jsx"
import {
  DemoShell,
  configureCanvasSize,
  fullscreenPipeline,
  startLoop,
  usePointer,
} from "./webgpuCommon.jsx"

export default function TechnoGrowthDemo() {
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

fn rotate(p: vec2f, a: f32) -> vec2f {
  let s = sin(a);
  let c = cos(a);
  return vec2f(p.x * c - p.y * s, p.x * s + p.y * c);
}

@fragment
fn fsMain(@location(0) uv: vec2f) -> @location(0) vec4f {
  let t = u.time;
  let aspect = u.w / u.h;
  var p = (uv - 0.5) * vec2f(aspect, 1.0);
  let m = (vec2f(u.mx, 1.0 - u.my) - 0.5) * vec2f(aspect, 1.0);
  
  var col = vec3f(0.01, 0.02, 0.03);
  
  // Recursive growth layers
  for(var i=1.0; i<=6.0; i+=1.0) {
    p = rotate(p, t * 0.1 + i);
    p = abs(p) - 0.2 * (1.0 + 0.2 * sin(t * 0.5 + i));
    
    let d = length(p);
    let line = smoothstep(0.02, 0.0, abs(d - 0.1));
    let pulse = 0.5 + 0.5 * sin(t * 2.0 - d * 10.0 + i);
    
    let gridCol = mix(vec3f(0.0, 1.0, 1.0), vec3f(1.0, 0.0, 1.0), 0.5 + 0.5 * sin(t + i));
    col += gridCol * line * pulse;
    
    // Joint connections
    let joint = smoothstep(0.04, 0.0, d);
    col += vec3f(1.0) * joint * (0.2 + 0.8 * pulse);
  }
  
  // Mouse distortion
  let mdist = length((uv - 0.5) * vec2f(aspect, 1.0) - m);
  col += vec3f(0.0, 0.5, 1.0) * exp(-mdist * 10.0) * (2.0 + u.down * 5.0);

  // Post-processing
  col = mix(col, col * col, 0.5);
  col = col / (col + vec3f(0.2));
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
      title="Techno-Organic Growth"
      hint="Recursive geometric vines grow through the data stream. Move mouse to influence the code."
      error={error ?? gpuError}
    >
      <canvas ref={canvasRef} width={1920} height={1080} style={{ width: '100%', height: '100%', display: 'block' }} className="demo-canvas" />
    </DemoShell>
  )
}
