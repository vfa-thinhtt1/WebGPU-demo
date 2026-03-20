import { useEffect, useRef, useState } from "react"
import { useWebGPU } from "./WebGPUContext.jsx"
import { DemoShell, configureCanvasSize, fullscreenPipeline, startLoop, usePointer } from "./webgpuCommon.jsx"

export default function GoldenSpiralDemo() {
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

@fragment
fn fsMain(@location(0) uv: vec2f) -> @location(0) vec4f {
  let aspect = u.w / u.h;
  var p = (uv - 0.5) * vec2f(aspect,1.0);

  var col = vec3f(0.0);
  
  let numPoints = 1500.0;
  let goldenAngle = 2.3999632; // 137.5 degrees in radians
  let time = u.time * 0.5;
  
  let activePoints = numPoints * (sin(time * 0.5) * 0.2 + 0.8);
  
  let r = length(p);
  let c = 0.015;
  let nApprox = (r * r) / (c * c);
  let baseN = floor(nApprox);
  
  var minDist = 100.0;
  var nearestN = 0.0;
  
  // Search local neighbor spectrum for exact point collisions
  for (var i = -40.0; i <= 40.0; i += 1.0) {
      let n = baseN + i;
      if (n < 0.0 || n > activePoints) { continue; }
      
      let radius = c * sqrt(n);
      var theta = n * goldenAngle + time;
      
      let px = radius * cos(theta);
      let py = radius * sin(theta);
      
      let d = length(p - vec2f(px, py));
      if (d < minDist) {
          minDist = d;
          nearestN = n;
      }
  }
  
  let ptSize = 0.005 + sin(nearestN * 0.1 - time * 5.0) * 0.003;
  let glow = 0.0005 / max(minDist - ptSize, 0.0001);
  
  let hue = vec3f(0.5) + 0.5 * cos(6.28318 * (vec3f(0.0, 0.33, 0.67) + nearestN * 0.003 - time));
  
  col += hue * glow;
  
  // Vignette / background cosmic glow
  col += vec3f(0.1, 0.0, 0.2) * (0.05 / max(r, 0.01));
  
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
      try { context?.unconfigure() } catch (_) { }
    }
  }, [gpuState, pointerRef])

  return (
    <DemoShell
      title="Golden Spiral"
      hint="Generative phyllotaxis nature pattern."
      error={error ?? gpuError}
    >
      <canvas ref={canvasRef} width={1920} height={1080} style={{ width: '100%', height: '100%', display: 'block' }} className="demo-canvas" />
    </DemoShell>
  )
}
