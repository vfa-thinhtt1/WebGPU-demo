import { useEffect, useRef, useState } from "react"
import { useWebGPU } from "./WebGPUContext.jsx"
import {
    DemoShell,
    configureCanvasSize,
    fullscreenPipeline,
    startLoop,
    usePointer,
} from "./webgpuCommon.jsx"

export default function PixelRainstormDemo() {
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
            return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453);
          }

          @fragment
          fn fsMain(@location(0) uv: vec2f) -> @location(0) vec4f {
            var col = vec3f(0.0);
            let time = u.time * 0.002;
            let mouse = vec2f(u.mx, u.my);

            // animate 300 falling pixels
            for(var i: i32 = 0; i < 300; i = i + 1) {
              let seed = vec2f(f32(i), 0.0);
              var x = fract(hash(seed) + sin(time*0.1 + f32(i))*0.3);
              var y = fract(hash(seed + vec2f(0.0,1.0)) + time*0.2 + cos(time*0.07 + f32(i)*0.1)*0.1);

              // push pixels with mouse
              x += (mouse.x - 0.5) * 0.1;
              y += (mouse.y - 0.5) * 0.1;
              x = fract(x);
              y = fract(y);

              let dx = uv.x - x;
              let dy = uv.y - y;
              let d = sqrt(dx*dx + dy*dy);
              col += vec3f(1.0, 0.3 + 0.7*fract(f32(i)*0.1), 1.0 - fract(f32(i)*0.2)) * smoothstep(0.02, 0.0, d);
            }

            col = pow(col, vec3f(0.4545));
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
            title="Animated Pixel Rain"
            hint="Watch neon pixels fall! Move your mouse to push them around."
            error={error ?? gpuError}
        >
            <canvas ref={canvasRef} width={1920} height={1080} style={{ width: '100%', height: '100%', display: 'block' }} className="demo-canvas" />
        </DemoShell>
    )
}