import { useEffect, useRef, useState } from "react"
import { useWebGPU } from "./WebGPUContext.jsx"
import { DemoShell, configureCanvasSize, fullscreenPipeline, startLoop, usePointer } from "./webgpuCommon.jsx"

export default function NeonDataStreamDemo() {
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
  time: f32,
  w: f32,
  h: f32,
  mx: f32,
  my: f32,
  mdx: f32,
  mdy: f32,
  down: f32
};

@group(0) @binding(0) var<uniform> u: Uniforms;

fn hash13(p3: vec3f) -> f32 {
  var p = fract(p3 * 0.1031);
  p += dot(p, p.yzx + 19.19);
  return fract((p.x + p.y) * p.z);
}

fn map(p_in: vec3f) -> f32 {
  var p = p_in;
  
  let id = floor(p * 2.0);
  let f = fract(p * 2.0) - 0.5;
  
  let d1 = length(f.xy) - 0.02;
  let d2 = length(f.xz) - 0.02;
  let d3 = length(f.yz) - 0.02;
  
  let grid = min(min(d1, d2), d3);
  
  // clear a hexagonal or cylindrical path
  let mask = length(p.xy) - 1.5;
  
  return max(grid, -mask);
}

@fragment
fn fsMain(@location(0) uv: vec2f) -> @location(0) vec4f {
  let aspect = u.w / u.h;
  let p = (uv - 0.5) * vec2f(aspect, 1.0) * 2.0;
  
  let mx = (u.mx - 0.5) * 2.0;
  let my = (0.5 - u.my) * 2.0;
  
  var ro = vec3f(mx * 0.5, my * 0.5, u.time * 4.0);
  let rd = normalize(vec3f(p.x, p.y, 1.0));
  
  // camera roll
  let roll = sin(u.time * 0.2) * 0.5;
  let s = sin(roll);
  let c = cos(roll);
  var rotated_rd = rd;
  rotated_rd.x = rd.x * c - rd.y * s;
  rotated_rd.y = rd.x * s + rd.y * c;
  
  var t = 0.0;
  var d = 0.0;
  var col = vec3f(0.0);
  var glow = vec3f(0.0);
  
  for(var i=0; i<90; i++) {
    let pos = ro + rotated_rd * t;
    d = map(pos);
    
    // Calculate glowing data packets moving along z
    let id = floor(pos * 2.0);
    let rand = hash13(id);
    // packets moving backwards relative to camera
    let packet_active = step(0.98, fract(pos.z * 1.5 - u.time * 10.0 * rand));
    
    let base_color = mix(vec3f(0.0, 1.0, 0.4), vec3f(0.0, 0.6, 1.0), rand);
    let packet_color = base_color * packet_active * 10.0;
    
    let g = 0.002 / (0.01 + d*d*20.0);
    glow += (base_color * 0.5 + packet_color) * g;
    
    if(d < 0.001 || t > 15.0) { break; }
    t += d * 0.9;
  }
  
  col += glow;
  
  // Fog over distance
  col = mix(col, vec3f(0.0, 0.02, 0.05), 1.0 - exp(-0.15*t));
  
  col = col / (vec3f(1.0) + col);
  col = pow(max(col, vec3f(0.0)), vec3f(0.4545));
  
  // Vignette
  col = col * (1.0 - 0.3*length(p));
  
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
          const p = pointerRef.current
          const { width, height } = configureCanvasSize(canvas, context, device, format)

          device.queue.writeBuffer(uniformBuffer, 0, new Float32Array([
            time, width, height,
            p.x, p.y, p.dx, p.dy, p.down ? 1 : 0,
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
      title="Neon Data Stream"
      hint="Traversing the dark web matrix."
      error={error ?? gpuError}
    >
      <canvas ref={canvasRef} width={1920} height={1080} style={{width:'100%',height:'100%',display:'block'}} className="demo-canvas" />
    </DemoShell>
  )
}
