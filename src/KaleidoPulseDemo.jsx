import { useEffect, useRef, useState } from "react"
import { useWebGPU } from "./WebGPUContext.jsx"
import {
    DemoShell,
    configureCanvasSize,
    fullscreenPipeline,
    startLoop,
    usePointer,
} from "./webgpuCommon.jsx"

export default function KaleidoPulseDemo() {
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
  let d = vec3f(0.0, 0.2, 0.4);
  return a + b * cos(6.28318 * (c * t + d));
}

// kaleidoscope fold
fn kaleido(p: vec2f, sides: f32) -> vec2f {
  let angle = atan2(p.y, p.x);
  let r = length(p);

  let sector = 6.28318 / sides;
  let a = mod(angle, sector);
  let mirrored = abs(a - sector * 0.5);

  return vec2f(cos(mirrored), sin(mirrored)) * r;
}

@fragment
fn fsMain(@location(0) uv: vec2f) -> @location(0) vec4f {

  let t = u.time;
  let aspect = u.w / u.h;

  var p = uv * 2.0 - 1.0;
  p.x *= aspect;

  let mouse = vec2f(u.mx * 2.0 - 1.0, (1.0 - u.my) * 2.0 - 1.0);

  // move symmetry center with mouse
  p -= mouse * 0.5;

  // ── kaleidoscope transform ──
  let sides = 6.0 + sin(t * 0.5) * 2.0;
  var kp = kaleido(p, sides);

  // ── grid pattern ──
  var gp = kp * 4.0;

  let grid = abs(fract(gp) - 0.5);
  let line = min(grid.x, grid.y);

  let tiles = smoothstep(0.2, 0.0, line);

  // ── pulse waves ──
  let r = length(kp);
  let pulse = sin(r * 12.0 - t * 3.0);

  // ── click shock ──
  let shock = sin(r * 30.0 - t * 10.0) * exp(-r * 3.0) * u.down;

  var energy = tiles + pulse * 0.5 + shock * 1.5;

  // ── color ──
  var col = palette(energy + r * 0.3 + t * 0.2);

  // neon grid boost
  col += vec3f(0.2, 0.8, 1.0) * tiles * 1.5;

  // glow
  let glow = smoothstep(0.3, 0.8, energy);
  col += col * glow * 0.8;

  // center highlight
  col += vec3f(1.0) * exp(-r * 5.0) * 0.4;

  // vignette
  col *= 1.0 - r * 0.8;

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
            title="Kaleidoscope Pulse Grid"
            hint="Move mouse to shift symmetry. Click to send pulse waves."
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