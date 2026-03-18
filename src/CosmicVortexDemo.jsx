import { useEffect, useRef, useState } from "react"
import { useWebGPU } from "./WebGPUContext.jsx"
import {
    DemoShell,
    configureCanvasSize,
    fullscreenPipeline,
    startLoop,
    usePointer,
} from "./webgpuCommon.jsx"

export default function CosmicVortexDemo() {
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

          fn hsv2rgb(h: vec3f) -> vec3f {
            let c = vec3f(1.0);
            let i = floor(h.x*6.0);
            let f = h.x*6.0 - i;
            let p = 0.0;
            let q = 1.0 - f;
            let t = f;
            var rgb = vec3f(0.0);
            switch(i % 6) {
              case 0: { rgb = vec3f(1.0,t,p) }
              case 1: { rgb = vec3f(q,1.0,p) }
              case 2: { rgb = vec3f(p,1.0,t) }
              case 3: { rgb = vec3f(p,q,1.0) }
              case 4: { rgb = vec3f(t,p,1.0) }
              case 5: { rgb = vec3f(1.0,p,q) }
              default: {}
            }
            return rgb;
          }

          @fragment
          fn fsMain(@location(0) uv: vec2f) -> @location(0) vec4f {
            let p = uv - 0.5;
            let aspect = 1.0;
            let t = u.time * 0.002;

            // vortex polar coordinates
            let r = length(p);
            let angle = atan2(p.y, p.x) + t*2.0;
            let spiral = sin(10.0*r - t*5.0 + angle*6.0);

            let hue = fract(angle*0.15 + t*0.1 + spiral*0.1);
            let brightness = smoothstep(0.0, 0.5, 1.0 - r + spiral*0.05);

            var col = hsv2rgb(vec3f(hue,1.0,brightness));

            // subtle trailing effect
            col *= 0.8 + 0.2*sin(5.0*r - t*2.0);

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
            title="Cosmic Ribbon Vortex"
            hint="Move your mouse to warp the colorful vortex!"
            error={error ?? gpuError}
        >
            <canvas ref={canvasRef} width={1920} height={1080} style={{ width: '100%', height: '100%', display: 'block' }} className="demo-canvas" />
        </DemoShell>
    )
}