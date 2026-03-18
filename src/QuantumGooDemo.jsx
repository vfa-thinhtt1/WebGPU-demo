import { useEffect, useRef, useState } from "react"
import { useWebGPU } from "./WebGPUContext.jsx"
import {
    DemoShell,
    configureCanvasSize,
    fullscreenPipeline,
    startLoop,
    usePointer,
} from "./webgpuCommon.jsx"

export default function QuantumGooDemo() {
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
            return fract(sin(dot(p, vec2f(127.1,311.7))) * 43758.5453);
          }

          fn noise(p: vec2f) -> f32 {
            let i = floor(p);
            let f = fract(p);
            let a = hash(i);
            let b = hash(i + vec2f(1.0,0.0));
            let c = hash(i + vec2f(0.0,1.0));
            let d = hash(i + vec2f(1.0,1.0));
            let u = f*f*(3.0-2.0*f);
            return mix(a,b,u.x) + (c-a)*u.y*(1.0-u.x) + (d-b)*u.x*u.y;
          }

          @fragment
          fn fsMain(@location(0) uv: vec2f) -> @location(0) vec4f {
            let p = uv - 0.5;
            let m = vec2f(u.mx, u.my) - 0.5;
            let t = u.time * 0.002;

            var col = vec3f(0.0);

            // Goo dynamics
            for(var i: i32 = 0; i < 5; i = i + 1) {
              let angle = t*0.5 + f32(i) * 2.0 + length(p - m)*6.0;
              let radius = 0.2 + 0.05 * sin(t*3.0 + f32(i));
              let d = length(p - vec2f(cos(angle), sin(angle)) * radius);
              col += vec3f(
                0.5 + 0.5*cos(6.2831*(d-t + f32(i))),
                0.5 + 0.5*sin(6.2831*(d-t + f32(i)*1.2)),
                0.5 + 0.5*cos(6.2831*(d-t*0.8))
              ) / (d*12.0 + 0.05);
            }

            // Subtle noise overlay
            col += vec3f(0.05,0.02,0.08)*noise(uv*6.0 + t);

            col = pow(col, vec3f(0.4545));
            return vec4f(col,1.0);
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
                            time,
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
            title="Quantum Goo"
            hint="Move your mouse to manipulate colorful goo blobs that dance and merge!"
            error={error ?? gpuError}
        >
            <canvas ref={canvasRef} width={1920} height={1080} style={{ width: '100%', height: '100%', display: 'block' }} className="demo-canvas" />
        </DemoShell>
    )
}