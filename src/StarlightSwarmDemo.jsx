import { useEffect, useRef, useState } from "react"
import { useWebGPU } from "./WebGPUContext.jsx"
import {
    DemoShell,
    configureCanvasSize,
    fullscreenPipeline,
    startLoop,
    usePointer,
} from "./webgpuCommon.jsx"

export default function StarlightSwarmDemo() {
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

// pseudo-random based on position
fn hash2(p: vec2f) -> f32 {
  let h = sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453;
  return fract(h);
}

// star positions and trails
fn starField(uv: vec2f, t: f32) -> f32 {
  var intensity = 0.0;
  for(var i = 0; i < 50; i++){
    let p = vec2f(hash2(vec2f(f32(i), 0.0)), hash2(vec2f(f32(i),1.0))) - 0.5;
    let speed = 0.2 + hash2(vec2f(f32(i),2.0)) * 0.5;
    let pos = p + vec2f(cos(t*speed+i)*0.3, sin(t*speed+i)*0.3);
    let d = length(uv - pos);
    intensity += 0.02 / (d*d + 0.001);
  }
  return intensity;
}

// mouse interaction
fn mouseEffect(uv: vec2f, mouse: vec2f, down: f32) -> f32 {
  let dist = length(uv - mouse);
  return exp(-dist*30.0)*(1.0 + down*2.0);
}

@fragment
fn fsMain(@location(0) uv: vec2f) -> @location(0) vec4f {
  let aspect = u.w / u.h
  let t = u.time
  let uvA = (uv - 0.5) * vec2f(aspect,1.0)

  let stars = starField(uvA, t)

  let mouse = vec2f(u.mx, u.my) * vec2f(aspect,1.0) - vec2f(0.5*aspect,0.5)
  let effect = mouseEffect(uvA, mouse, u.down)

  let val = stars + effect

  // glowing star color
  var col = vec3f(val, val*0.6, val*1.0)

  col = pow(max(col, vec3f(0.0)), vec3f(1.0/2.2))
  return vec4f(col,1.0)
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
            title="Starlight Swarm"
            hint="Move mouse to attract stars. Click to create star bursts."
            error={error ?? gpuError}
        >
            <canvas ref={canvasRef} width={1920} height={1080} style={{ width: '100%', height: '100%', display: 'block' }} className="demo-canvas" />
        </DemoShell>
    )
}