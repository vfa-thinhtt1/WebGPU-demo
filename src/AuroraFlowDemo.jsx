import { useEffect, useRef, useState } from "react"
import { useWebGPU } from "./WebGPUContext.jsx"
import {
    DemoShell,
    configureCanvasSize,
    fullscreenPipeline,
    startLoop,
    usePointer,
} from "./webgpuCommon.jsx"

export default function AuroraFlowDemo() {
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

fn falloff(d: f32) -> f32 {
  return 1.0 / (1.0 + d * d * 10.0);
}

@fragment
fn fsMain(@location(0) uv: vec2f) -> @location(0) vec4f {

  let t = u.time;
  let aspect = u.w / u.h;

  var p = uv * 2.0 - 1.0;
  p.x *= aspect;

  let mouse = vec2f(u.mx * 2.0 - 1.0, (1.0 - u.my) * 2.0 - 1.0);

  // ── base flowing ribbons ──
  let f1 = sin(p.x * 2.5 + t * 0.6);
  let f2 = sin(p.x * 4.0 - t * 0.4 + f1 * 0.5);
  let f3 = sin(p.x * 6.0 + t * 0.3 + f2 * 0.4);

  var flow = (f1 + f2 + f3) * 0.33;

  // vertical shaping (aurora look)
  flow *= exp(-abs(p.y) * 2.0);

  // ── warp space ──
  var rp = p;
  rp.y += flow * 0.4;

  let detail = sin(rp.x * 10.0 + t + flow * 2.0) * 0.5 + 0.5;

  // ── mouse interaction ──
  let d = length(p - mouse);
  let influence = falloff(d * 2.0);

  rp += normalize(mouse - p) * influence * 0.4;

  // ── click burst ──
  let burst = sin(d * 20.0 - t * 6.0) * falloff(d * 4.0) * u.down;

  // ── energy ──
  let energy = flow * 0.7 + detail * 0.5 + influence * 0.8 + burst * 1.5;

  // ── aurora colors ──
  let green = vec3f(0.1, 1.0, 0.5);
  let cyan  = vec3f(0.1, 0.8, 1.0);
  let purple= vec3f(0.6, 0.2, 1.0);

  var col = mix(green, cyan, detail);
  col = mix(col, purple, flow * 0.5 + 0.5);

  // glow
  let glow = smoothstep(0.3, 0.7, energy);
  col += col * glow * 0.6;

  // burst highlight
  col += vec3f(1.0) * burst;

  // fade bottom/top
  let fade = exp(-abs(p.y) * 1.5);
  col *= fade;

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
            title="Aurora Energy Flow"
            hint="Move mouse to bend the aurora. Click to release energy."
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