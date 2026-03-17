import { useEffect, useRef, useState } from "react"
import { useWebGPU } from "./WebGPUContext.jsx"
import { DemoShell, configureCanvasSize, fullscreenPipeline, startLoop, usePointer } from "./webgpuCommon.jsx"

export default function FractalTunnelDemo() {
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

fn palette(t:f32)->vec3f{
  return vec3f(
    0.5 + 0.5*sin(6.2831*(t+0.0)),
    0.5 + 0.5*sin(6.2831*(t+0.33)),
    0.5 + 0.5*sin(6.2831*(t+0.66))
  );
}

@fragment
fn fsMain(@location(0) uv: vec2f) -> @location(0) vec4f {

  let aspect = u.w / u.h;
  var p = (uv - 0.5) * vec2f(aspect,1.0);

  let mouse = (vec2f(u.mx,u.my)-0.5) * vec2f(aspect,1.0);

  p += mouse * 0.5;

  let r = length(p);
  let a = atan2(p.y,p.x);

  var t = u.time * 0.6;

  var tunnel = sin(10.0*(1.0/r) + t);
  var rings  = sin(8.0*r - t*2.0);
  var v = tunnel + rings;

  let col = palette(v + r*0.5 + u.time*0.1);
  let glow = 0.15/(r+0.05);

  return vec4f(col*(1.0+glow),1.0);
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
            p.x, 1 - p.y, p.dx, -p.dy, p.down ? 1 : 0,
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
      title="Fractal Tunnel"
      hint="Move mouse to bend the tunnel."
      error={error ?? gpuError}
    >
      <canvas ref={canvasRef} width={1920} height={1080} style={{width:'100%',height:'100%',display:'block'}} className="demo-canvas" />
    </DemoShell>
  )
}