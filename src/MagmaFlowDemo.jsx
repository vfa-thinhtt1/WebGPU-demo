import { useEffect, useRef, useState } from "react"
import { useWebGPU } from "./WebGPUContext.jsx"
import {
    DemoShell,
    configureCanvasSize,
    fullscreenPipeline,
    startLoop,
    usePointer,
} from "./webgpuCommon.jsx"

export default function MagmaFlowDemo() {
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
                        size: 64,
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

fn rot(a: f32) -> mat2x2f {
    let s = sin(a);
    let c = cos(a);
    return mat2x2f(c, -s, s, c);
}

// Layered noise for the "crust"
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

@fragment
fn fsMain(@location(0) uv: vec2f) -> @location(0) vec4f {
    let aspect = u.w / u.h;
    var p = (uv - 0.5) * vec2f(aspect, 1.0);
    let m = (vec2f(u.mx, 1.0 - u.my) - 0.5) * vec2f(aspect, 1.0);
    
    let t = u.time * 0.4;
    
    // Distort space to simulate viscous flow
    for(var i: f32 = 1.0; i < 4.0; i += 1.0) {
        p.x += 0.3 / i * sin(i * 3.0 * p.y + t);
        p.y += 0.3 / i * cos(i * 3.0 * p.x + t);
    }

    // Interaction: Mouse "cools" the magma, Click "cracks" it
    let d = length(p - m);
    let mouseInfluence = exp(-5.0 * d);
    
    // Core heat map
    let v = noise(p * 2.5 + t * 0.2);
    let brightness = smoothstep(0.2, 0.8, v + (mouseInfluence * u.down * 1.5));
    
    // Magma coloring
    let fire = vec3f(1.0, 0.3, 0.05); // Orange-Red
    let core = vec3f(1.0, 0.8, 0.2);  // Yellow-White
    let rock = vec3f(0.05, 0.02, 0.02); // Dark Crust
    
    // Mix based on "heat"
    var col = mix(rock, fire, brightness);
    col = mix(col, core, pow(brightness, 4.0));
    
    // Add glowing "veins"
    let veins = abs(sin(v * 10.0 + t)) * 0.1 * brightness;
    col += fire * veins;

    // Darken where mouse "cools" the surface (when not clicking)
    col *= mix(1.0, 0.2, mouseInfluence * (1.0 - u.down));

    // Post-process
    col = col / (col + vec3f(0.5)); // Simple tonemap
    col = pow(col, vec3f(1.0/2.2)); // Gamma
    
    return vec4f(col, 1.0);
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
            title="Magma Flow 🌋"
            hint="Move mouse to cool the surface. Click to crack the crust and release heat."
            error={error ?? gpuError}
        >
            <canvas ref={canvasRef} style={{ width: "100%", height: "100%", cursor: "crosshair" }} />
        </DemoShell>
    )
}