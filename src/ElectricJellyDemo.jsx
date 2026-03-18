import { useEffect, useRef, useState } from "react"
import { useWebGPU } from "./WebGPUContext.jsx"
import {
    DemoShell,
    configureCanvasSize,
    fullscreenPipeline,
    startLoop,
    usePointer,
} from "./webgpuCommon.jsx"

export default function ElectricJellyDemo() {
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
                        size: 32,
                        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
                    })

                    const pipeline = fullscreenPipeline({
                        device,
                        format,
                        fragmentCode: /* wgsl */ `
          struct U {
            time: f32,
            mx: f32,
            my: f32,
            down: f32,
          };
          @group(0) @binding(0) var<uniform> u: U;

          fn hash(p: vec2f) -> f32 {
            let h = dot(p, vec2f(127.1, 311.7));
            return fract(sin(h) * 43758.5453);
          }

          fn noise(p: vec2f) -> f32 {
            let i = floor(p);
            let f = fract(p);
            let a = hash(i);
            let b = hash(i + vec2f(1.0, 0.0));
            let c = hash(i + vec2f(0.0, 1.0));
            let d = hash(i + vec2f(1.0, 1.0));
            let u = f*f*(3.0-2.0*f);
            return mix(a,b,u.x) + (c-a)*u.y*(1.0-u.x) + (d-b)*u.x*u.y;
          }

          @fragment
          fn fsMain(@location(0) uv: vec2f) -> @location(0) vec4f {
            let p = uv - 0.5;
            let mouse = vec2f(u.mx, u.my) - 0.5;
            let dist = length(p - mouse);

            // Jellyfish pulse
            let t = u.time * 0.5;
            let radius = 0.02 + 0.01 * sin(t*3.0 + dist*10.0);

            let glow = exp(-pow(dist/radius, 2.5));

            // Electric tentacle effect
            let angle = atan2(p.y - mouse.y, p.x - mouse.x);
            let streak = sin(20.0 * dist - t*5.0 + angle*6.0)*0.5 + 0.5;

            let col = vec3f(glow*streak, glow*pow(streak,1.5), glow*pow(1.0-streak,1.2));

            // Background subtle flicker
            col += vec3f(0.02,0.01,0.03)*noise(uv*5.0 + t);

            col = pow(col, vec3f(0.4545)); // gamma
            return vec4f(col, 1.0);
          }
          `
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
                        configureCanvasSize(canvas, context, device, format)

                        device.queue.writeBuffer(uniformBuffer, 0, new Float32Array([
                            time * 0.001,
                            ptr.x,
                            1 - ptr.y,
                            ptr.down ? 1 : 0,
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
            title="Electric Jellyfish"
            hint="Move your mouse to summon pulsing electric jellyfish with glowing tentacles!"
            error={error ?? gpuError}
        >
            <canvas ref={canvasRef} width={1920} height={1080} style={{ width: '100%', height: '100%', display: 'block' }} className="demo-canvas" />
        </DemoShell>
    )
}