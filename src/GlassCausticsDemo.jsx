import { useEffect, useRef, useState } from "react"
import { useWebGPU } from "./WebGPUContext.jsx"
import {
    DemoShell,
    configureCanvasSize,
    fullscreenPipeline,
    startLoop,
    usePointer,
} from "./webgpuCommon.jsx"

export default function GlassCausticsDemo() {
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

// fast falloff
fn falloff(d: f32) -> f32 {
  return 1.0 / (1.0 + d * d * 12.0);
}

@fragment
fn fsMain(@location(0) uv: vec2f) -> @location(0) vec4f {

  let t = u.time;
  let aspect = u.w / u.h;

  var p = uv * 2.0 - 1.0;
  p.x *= aspect;

  let mouse = vec2f(u.mx * 2.0 - 1.0, (1.0 - u.my) * 2.0 - 1.0);

  // ── layered refraction waves ──
  let w1 = sin(p.x * 6.0 + t * 0.8);
  let w2 = sin(p.y * 5.0 - t * 0.6);
  let w3 = sin((p.x + p.y) * 4.0 + t * 0.5);

  let base = (w1 + w2 + w3) * 0.33;

  // ── domain distortion (refraction effect) ──
  var rp = p;
  rp += vec2f(
    sin(base * 2.0 + t),
    cos(base * 2.0 - t)
  ) * 0.2;

  // second layer (fine caustics)
  let c1 = sin(rp.x * 10.0 - t * 1.2);
  let c2 = sin(rp.y * 9.0 + t * 1.0);
  let caustics = (c1 + c2) * 0.5;

  // ── mouse light bending ──
  let d = length(p - mouse);
  let influence = falloff(d * 2.0);

  rp += normalize(p - mouse) * influence * 0.25;

  // ── click flash ──
  let flash = falloff(d * 5.0) * u.down;

  // ── energy ──
  let energy = base * 0.4 + caustics * 0.6 + influence * 0.8 + flash * 1.5;

  // ── glassy colors ──
  let deep  = vec3f(0.02, 0.05, 0.08);
  let aqua  = vec3f(0.1, 0.8, 1.0);
  let light = vec3f(0.6, 1.0, 1.0);

  var col = mix(deep, aqua, energy * 0.5 + 0.5);
  col = mix(col, light, pow(energy, 2.0));

  // caustic highlights
  let highlights = smoothstep(0.4, 0.6, caustics);
  col += light * highlights * 0.5;

  // flash highlight
  col += vec3f(1.0) * flash;

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
            title="Glass Caustics"
            hint="Move mouse to bend light. Click to flash energy."
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