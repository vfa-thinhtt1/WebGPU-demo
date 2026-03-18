import { useEffect, useRef, useState } from "react"
import { useWebGPU } from "./WebGPUContext.jsx"
import {
    DemoShell,
    configureCanvasSize,
    fullscreenPipeline,
    startLoop,
    usePointer,
} from "./webgpuCommon.jsx"

export default function ElectricNeuralWebDemo() {
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

// hash for pseudo-random
fn hash2(p: vec2f) -> f32 {
  return fract(sin(dot(p, vec2f(12.9898,78.233)))*43758.5453);
}

// electric web node
fn node(pos: vec2f, uv: vec2f, t: f32) -> f32 {
  let d = length(uv - pos)
  return 0.01 / (d*d + 0.0001) * (0.5 + 0.5*sin(t*5.0 + d*20.0))
}

@fragment
fn fsMain(@location(0) uv: vec2f) -> @location(0) vec4f {
  let t = u.time
  let uvA = uv - 0.5
  var intensity = 0.0

  // generate network of nodes
  for(var i = 0; i < 15; i++){
    for(var j = 0; j < 10; j++){
      let x = f32(i)/15.0 - 0.5
      let y = f32(j)/10.0 - 0.5
      let pos = vec2f(x + sin(t*0.2+i)*0.02, y + cos(t*0.3+j)*0.02)
      intensity += node(pos, uvA, t)
      // edges
      if(i<14){
        let x2 = f32(i+1)/15.0 - 0.5
        let pos2 = vec2f(x2 + sin(t*0.2+i+1)*0.02, y + cos(t*0.3+j)*0.02)
        let dist = length(uvA - 0.5*(pos+pos2))
        intensity += 0.008 / (dist*dist + 0.0001)
      }
    }
  }

  // mouse pulse
  let mouse = vec2f(u.mx, u.my) - vec2f(0.5,0.5)
  let dMouse = length(uvA - mouse)
  intensity += u.down*0.05 / (dMouse*dMouse + 0.001)

  let col = vec3f(intensity, intensity*0.5, intensity*1.0)
  col = pow(max(col, vec3f(0.0)), vec3f(1.0/2.2))
  return vec4f(col, 1.0)
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
            title="Electric Neural Web"
            hint="Move mouse to interact with the web. Click to send electric pulses."
            error={error ?? gpuError}
        >
            <canvas ref={canvasRef} width={1920} height={1080} style={{ width: '100%', height: '100%', display: 'block' }} className="demo-canvas" />
        </DemoShell>
    )
}