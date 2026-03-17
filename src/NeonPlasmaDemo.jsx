import { useEffect, useRef, useState } from "react"
import { initWebGPU } from "./webgpuUtils.js"
import { DemoShell, configureCanvasSize, fullscreenPipeline, startLoop, usePointer } from "./webgpuCommon.jsx"

export default function NeonPlasmaDemo() {
  const canvasRef = useRef(null)
  const pointerRef = usePointer(canvasRef)
  const [error, setError] = useState(null)

  useEffect(() => {
    let stop = () => { }
    let cleanup = () => { }

      ; (async () => {
        try {
          const canvas = canvasRef.current
          if (!canvas) return

          const { device, context, format } = await initWebGPU(canvas)

          const uniformBuffer = device.createBuffer({
            size: 4 * 8,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
          })

          const pipeline = fullscreenPipeline({
            device,
            format,
            fragmentCode: /* wgsl */ `

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

  let aspect = u.w / u.h
  var p = (uv - 0.5) * vec2f(aspect,1.0)

  let m = (vec2f(u.mx,u.my)-0.5) * vec2f(aspect,1.0)

  let d = distance(p,m)

  let warp = 0.25 / (d + 0.05)

  p += normalize(p-m) * warp * (0.3 + u.down)

  var v = 0.0
  v += sin(p.x*6.0 + u.time)
  v += sin(p.y*6.0 - u.time*1.2)
  v += sin((p.x+p.y)*4.0 + u.time*0.7)

  v = v/3.0

  let col = palette(v + u.time*0.05)

  let glow = exp(-d*4.0)

  return vec4f(col*(1.0+glow*1.5),1.0)
}
          `,
          })

          const bindGroup = device.createBindGroup({
            layout: pipeline.getBindGroupLayout(0),
            entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
          })

          const onResize = () =>
            configureCanvasSize(canvas, context, device, format)

          onResize()
          window.addEventListener("resize", onResize)

          cleanup = () => window.removeEventListener("resize", onResize)

          stop = startLoop((time) => {
            const p = pointerRef.current

            const { width, height } = configureCanvasSize(
              canvas,
              context,
              device,
              format
            )

            device.queue.writeBuffer(
              uniformBuffer,
              0,
              new Float32Array([
                time,
                width,
                height,
                p.x,
                1 - p.y,
                p.dx,
                -p.dy,
                p.down ? 1 : 0,
              ])
            )

            const encoder = device.createCommandEncoder()

            const pass = encoder.beginRenderPass({
              colorAttachments: [
                {
                  view: context.getCurrentTexture().createView(),
                  clearValue: { r: 0, g: 0, b: 0, a: 1 },
                  loadOp: "clear",
                  storeOp: "store",
                },
              ],
            })

            pass.setPipeline(pipeline)
            pass.setBindGroup(0, bindGroup)
            pass.draw(6)
            pass.end()

            device.queue.submit([encoder.finish()])
          })
        } catch (e) {
          console.error(e)
          setError(e?.message ?? String(e))
        }
      })()

    return () => {
      stop()
      cleanup()
    }
  }, [pointerRef])

  return (
    <DemoShell
      title="Neon Plasma"
      hint="Move mouse to distort plasma. Hold click to increase energy."
      error={error}
    >
      <canvas ref={canvasRef} width={720} height={420} className="demo-canvas" />
    </DemoShell>
  )
}