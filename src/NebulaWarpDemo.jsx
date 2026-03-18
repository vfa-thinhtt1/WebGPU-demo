import { useEffect, useRef, useState } from "react"
import { useWebGPU } from "./WebGPUContext.jsx"
import {
    DemoShell,
    configureCanvasSize,
    fullscreenPipeline,
    startLoop,
    usePointer,
} from "./webgpuCommon.jsx"

export default function NebulaWarpDemo() {
    const canvasRef = useRef(null)
    const pointerRef = usePointer(canvasRef)
    const { gpuState, error: gpuError } = useWebGPU()
    const [error, setError] = useState(null)

    useEffect(() => {
        if (!gpuState) return

        const { device, format } = gpuState
        const canvas = canvasRef.current
        if (!canvas) return

        let stop = () => { }
        let context = null

            ; (async () => {
                try {
                    context = canvas.getContext("webgpu")
                    context.configure({ device, format, alphaMode: "premultiplied" })

                    const uniformBuffer = device.createBuffer({
                        size: 64, // Padded for safety
                        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
                    })

                    const pipeline = await fullscreenPipeline({
                        device,
                        format,
                        fragmentCode: /* wgsl */ `
struct U {
  time : f32,
  w    : f32,
  h    : f32,
  mx   : f32,
  my   : f32,
  down : f32,
};
@group(0) @binding(0) var<uniform> u: U;

fn hash(p: vec2f) -> f32 {
    return fract(sin(dot(p, vec2f(12.9898, 78.233))) * 43758.5453);
}

fn noise(p: vec2f) -> f32 {
    let i = floor(p);
    let f = fract(p);
    let u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2f(1,0)), u.x),
               mix(hash(i + vec2f(0,1)), hash(i + vec2f(1,1)), u.x), u.y);
}

fn fbm(p: vec2f) -> f32 {
    var v = 0.0;
    var a = 0.5;
    var shift = vec2f(100.0);
    let rot = mat2x2f(cos(0.5), sin(0.5), -sin(0.5), cos(0.5));
    for (var i = 0; i < 6; i++) {
        v += a * noise(p);
        p = rot * p * 2.0 + shift;
        a *= 0.5;
    }
    return v;
}

@fragment
fn fsMain(@location(0) uv: vec2f) -> @location(0) vec4f {
    let aspect = u.w / u.h;
    let p = (uv - 0.5) * vec2f(aspect, 1.0);
    let m = (vec2f(u.mx, 1.0 - u.my) - 0.5) * vec2f(aspect, 1.0);
    
    // Gravitational Warp
    let dist = length(p - m);
    let strength = 0.3 * exp(-2.0 * dist);
    let warpedP = p + (p - m) * strength * (1.0 - u.down * 2.0);

    // Cosmic Swirl (Domain Warping)
    let t = u.time * 0.2;
    let q = vec2f(fbm(warpedP + t), fbm(warpedP + vec2f(5.2, 1.3)));
    let r = vec2f(fbm(warpedP + 4.0 * q + vec2f(1.7, 9.2) + t * 0.5), 
                  fbm(warpedP + 4.0 * q + vec2f(8.3, 2.8) + t * 0.3));
    
    let f = fbm(warpedP + 4.0 * r);

    // Deep Space Colors
    var col = mix(vec3f(0.05, 0.0, 0.1), vec3f(0.0, 0.2, 0.4), clamp(f*f, 0.0, 1.0));
    col = mix(col, vec3f(0.8, 0.1, 0.5), clamp(length(q), 0.0, 1.0));
    col = mix(col, vec3f(0.9, 0.9, 1.0), clamp(length(r.x), 0.0, 1.0));

    // Star Glow & Supernova Burst
    let burst = exp(-15.0 * dist) * u.down * 2.0;
    col += (f * f * f + 0.5 * f * f + 0.3 * f) * col;
    col += vec3f(0.6, 0.8, 1.0) * burst;

    // Contrast & Vignette
    col = pow(col * 1.5, vec3f(1.4));
    let vig = smoothstep(1.5, 0.3, length(p));
    
    return vec4f(col * vig, 1.0);
}
`,
                    })

                    const bindGroup = device.createBindGroup({
                        layout: pipeline.getBindGroupLayout(0),
                        entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
                    })

                    const onResize = () => configureCanvasSize(canvas, context, device, format)
                    window.addEventListener("resize", onResize)

                    stop = startLoop((time) => {
                        const ptr = pointerRef.current
                        const { width, height } = configureCanvasSize(canvas, context, device, format)

                        device.queue.writeBuffer(
                            uniformBuffer,
                            0,
                            new Float32Array([
                                time, width, height, ptr.x, ptr.y, ptr.down ? 1 : 0
                            ])
                        )

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
                } catch (e) {
                    setError(e.message)
                }
            })()

        return () => {
            stop()
            context?.unconfigure()
        }
    }, [gpuState, pointerRef])

    return (
        <DemoShell
            title="Nebula Warp 🌌"
            hint="Hover to warp space. Click to trigger a star-birth burst."
            error={error ?? gpuError}
        >
            <canvas ref={canvasRef} style={{ width: "100%", height: "100%" }} />
        </DemoShell>
    )
}