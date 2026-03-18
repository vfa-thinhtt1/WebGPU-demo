import { useEffect, useRef, useState } from "react"
import { useWebGPU } from "./WebGPUContext.jsx"
import {
    DemoShell,
    configureCanvasSize,
    fullscreenPipeline,
    startLoop,
    usePointer,
} from "./webgpuCommon.jsx"

export default function CelestialOrbSwirlDemo() {
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
            let i = floor(h.x*6.0);
            let f = h.x*6.0 - i;
            let p = h.z*(1.0-h.y);
            let q = h.z*(1.0-f*h.y);
            let t = h.z*(1.0-(1.0-f)*h.y);
            var c = vec3f(0.0);
            switch(i % 6) {
              case 0: { c=vec3f(h.z,t,p) }
              case 1: { c=vec3f(q,h.z,p) }
              case 2: { c=vec3f(p,h.z,t) }
              case 3: { c=vec3f(p,q,h.z) }
              case 4: { c=vec3f(t,p,h.z) }
              case 5: { c=vec3f(h.z,p,q) }
              default: {}
            }
            return c;
          }

          @fragment
          fn fsMain(@location(0) uv: vec2f) -> @location(0) vec4f {
            let p = uv - 0.5;
            let t = u.time * 0.002;
            let m = vec2f(u.mx-0.5,u.my-0.5);

            var col = vec3f(0.0);
            for(var i: i32=0; i<12; i=i+1){
              let angle = t + f32(i)*0.5;
              var pos = vec2f(cos(angle), sin(angle)) * 0.3;
              pos += m * 0.1; // mouse influence
              let d = length(p - pos);
              let hue = fract(f32(i)*0.08 + t*0.1);
              col += hsv2rgb(vec3f(hue,0.8,1.0)) * smoothstep(0.05,0.0,d);
            }

            // soft glow background
            col += vec3f(0.01,0.02,0.04) * exp(-10.0*length(p));

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
            title="Celestial Orb Swirl"
            hint="Move your mouse to shift and bend the orbiting celestial orbs."
            error={error ?? gpuError}
        >
            <canvas ref={canvasRef} width={1920} height={1080} style={{ width: '100%', height: '100%', display: 'block' }} className="demo-canvas" />
        </DemoShell>
    )
}