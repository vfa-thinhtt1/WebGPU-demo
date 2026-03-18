import { useEffect, useRef, useState } from "react"
import { useWebGPU } from "./WebGPUContext.jsx"
import {
    DemoShell,
    configureCanvasSize,
    fullscreenPipeline,
    startLoop,
    usePointer,
} from "./webgpuCommon.jsx"

export default function PlasmaVortexDemo() {
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

fn hash(p: vec2f) -> f32 {
  return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453);
}

fn noise(p: vec2f) -> f32 {
  let i = floor(p);
  let f = fract(p);

  let a = hash(i);
  let b = hash(i + vec2f(1.0, 0.0));
  let c = hash(i + vec2f(0.0, 1.0));
  let d = hash(i + vec2f(1.0, 1.0));

  let u = f * f * (3.0 - 2.0 * f);

  return mix(a, b, u.x) +
         (c - a)*u.y*(1.0 - u.x) +
         (d - b)*u.x*u.y;
}

@fragment
fn fsMain(@location(0) uv: vec2f) -> @location(0) vec4f {

  let t = u.time * 0.7;
  let aspect = u.w / u.h;

  var p = uv * 2.0 - 1.0;
  p.x *= aspect;

  let mouse = vec2f(u.mx * 2.0 - 1.0, (1.0 - u.my) * 2.0 - 1.0);

  // ── vortex rotation ──
  let angle = atan2(p.y, p.x);
  let radius = length(p);

  var swirl = angle + t * 0.6 + radius * 2.0;

  // ── mouse gravity ──
  let d = length(p - mouse);
  let attract = 1.0 / (1.0 + d * 6.0);

  swirl += attract * 2.0;

  // ── domain warp ──
  var q = vec2f(cos(swirl), sin(swirl)) * radius;

  let n = noise(q * 3.0 + t);

  // ── plasma layers ──
  let plasma = sin(q.x * 6.0 + n * 4.0 + t * 2.0) * 0.5 + 0.5;
  let plasma2 = sin(q.y * 8.0 - t * 1.5) * 0.5 + 0.5;

  var energy = plasma * 0.6 + plasma2 * 0.4;

  // ── click implosion ──
  let shock = sin(radius * 25.0 - t * 10.0) * exp(-radius * 4.0) * u.down;
  energy += shock * 1.5;

  // ── colors ──
  let col1 = vec3f(0.2, 0.4, 1.0);
  let col2 = vec3f(0.8, 0.2, 1.0);
  let col3 = vec3f(1.0, 0.5, 0.2);

  var col = mix(col1, col2, energy);
  col = mix(col, col3, energy * energy);

  // glow
  let glow = smoothstep(0.4, 0.8, energy);
  col += col * glow * 0.8;

  // center brightness
  col += vec3f(1.0) * exp(-radius * 6.0) * 0.5;

  // vignette
  col *= 1.0 - radius * 0.7;

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
            title="Liquid Plasma Vortex"
            hint="Move mouse = gravity well. Click = energy implosion."
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