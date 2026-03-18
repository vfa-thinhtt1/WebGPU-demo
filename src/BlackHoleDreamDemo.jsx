import { useEffect, useRef, useState } from "react"
import { useWebGPU } from "./WebGPUContext.jsx"
import {
    DemoShell,
    configureCanvasSize,
    fullscreenPipeline,
    startLoop,
    usePointer,
} from "./webgpuCommon.jsx"

export default function BlackHoleDreamDemo() {
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
                        fragmentCode: /* wgsl */`

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

fn palette(t: f32) -> vec3f {
  let a = vec3f(0.5, 0.5, 0.5);
  let b = vec3f(0.5, 0.5, 0.5);
  let c = vec3f(1.0, 1.0, 1.0);
  let d = vec3f(0.0, 0.15, 0.25);
  return a + b * cos(6.28318 * (c * t + d));
}

@fragment
fn fsMain(@location(0) uv: vec2f) -> @location(0) vec4f {

  let t = u.time * 0.5;
  let aspect = u.w / u.h;

  var p = uv * 2.0 - 1.0;
  p.x *= aspect;

  // mouse = black hole position
  let bh = vec2f(u.mx * 2.0 - 1.0, (1.0 - u.my) * 2.0 - 1.0);

  var dir = p - bh;
  var r = length(dir);

  // ── gravitational lensing ──
  let strength = 0.4;
  let lens = strength / (r * r + 0.05);

  var warped = p + normalize(dir) * lens;

  // ── polar coords ──
  let angle = atan2(warped.y - bh.y, warped.x - bh.x);
  let radius = length(warped - bh);

  // ── accretion disk ──
  let disk = exp(-abs(radius - 0.35) * 20.0);

  let swirl = angle + t * 2.0 + radius * 6.0;

  let band = sin(swirl * 6.0) * 0.5 + 0.5;
  let band2 = sin(swirl * 3.0 - t) * 0.5 + 0.5;

  var energy = disk * (band * 0.6 + band2 * 0.4);

  // ── glow halo ──
  let halo = exp(-radius * 3.0) * 0.6;
  energy += halo;

  // ── click distortion pulse ──
  let pulse = sin(r * 30.0 - t * 10.0) * exp(-r * 4.0) * u.down;
  energy += pulse * 1.2;

  // ── colors ──
  var col = palette(energy + radius * 0.2);

  // bright disk
  col += vec3f(1.0, 0.9, 0.7) * disk * 1.5;

  // event horizon (black core)
  let horizon = smoothstep(0.12, 0.14, radius);
  col *= horizon;

  // glow
  let glow = smoothstep(0.3, 0.8, energy);
  col += col * glow * 0.8;

  // vignette
  let vig = 1.0 - length(uv - 0.5) * 1.2;
  col *= vig;

  // gamma
  col = pow(col, vec3f(1.0 / 2.2));

  return vec4f(col, 1.0);
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
                            ptr.x, ptr.y, ptr.dx, ptr.dy, ptr.down ? 1 : 0,
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
            title="Black Hole Dream"
            hint="Move mouse = move black hole. Click = distortion pulse."
            error={error ?? gpuError}
        >
            <canvas
                ref={canvasRef}
                width={1920}
                height={1080}
                style={{ width: "100%", height: "100%", display: "block" }}
            />
        </DemoShell>
    )
}