import { useEffect, useRef, useState } from "react"
import { useWebGPU } from "./WebGPUContext.jsx"
import {
    DemoShell,
    configureCanvasSize,
    fullscreenPipeline,
    startLoop,
    usePointer,
} from "./webgpuCommon.jsx"

export default function DigitalRainDemo() {
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

// pseudo random
fn rand(x: f32) -> f32 {
  return fract(sin(x * 12.9898) * 43758.5453);
}

// fast falloff
fn falloff(d: f32) -> f32 {
  return 1.0 / (1.0 + d * d * 15.0);
}

@fragment
fn fsMain(@location(0) uv: vec2f) -> @location(0) vec4f {

  let t = u.time;
  let aspect = u.w / u.h;

  var p = uv;
  p.x *= aspect;

  let mouse = vec2f(u.mx, u.my);

  // ── column index ──
  let col = floor(p.x * 40.0);
  let rnd = rand(col);

  // ── vertical flow ──
  let speed = mix(0.5, 2.0, rnd);
  let y = fract(p.y + t * speed);

  // ── character shape ──
  let char = step(0.8, fract(y * 20.0 + rnd * 10.0));

  // ── trail fade ──
  let trail = smoothstep(1.0, 0.0, y);

  // ── brightness ──
  var brightness = char * trail;

  // ── mouse distortion ──
  let d = distance(uv, mouse);
  let influence = falloff(d * 2.0);

  brightness += influence * 0.5;

  // ── glitch burst ──
  let glitch = u.down * step(0.7, rand(col + floor(t * 10.0)));
  brightness += glitch * 1.2;

  // ── color ──
  let green = vec3f(0.1, 1.0, 0.3);
  let cyan  = vec3f(0.2, 1.0, 0.9);
  let white = vec3f(1.0);

  var colr = mix(green, cyan, rnd);
  colr *= brightness;

  // highlight leading character
  colr += white * step(0.95, y) * brightness;

  // vignette
  let vig = 1.0 - length(uv - 0.5) * 1.2;
  colr *= vig;

  // gamma
  colr = pow(colr, vec3f(1.0 / 2.2));

  return vec4f(colr, 1.0);
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
            title="Digital Rain"
            hint="Move mouse to distort streams. Click to trigger glitch bursts."
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