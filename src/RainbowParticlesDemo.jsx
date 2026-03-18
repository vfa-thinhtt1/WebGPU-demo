import { useEffect, useRef, useState } from "react"
import { useWebGPU } from "./WebGPUContext.jsx"
import {
    DemoShell,
    configureCanvasSize,
    fullscreenPipeline,
    startLoop,
    usePointer,
} from "./webgpuCommon.jsx"

export default function RainbowParticlesDemo() {
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

// hash for pseudo random
fn hash(p: vec2f) -> f32 {
  return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453123);
}

// rainbow palette
fn palette(t: f32) -> vec3f {
  return 0.5 + 0.5 * cos(6.28318 * (vec3f(0.0,0.33,0.67) + t));
}

@fragment
fn fsMain(@location(0) uv: vec2f) -> @location(0) vec4f {

  let t = u.time * 0.6;
  let aspect = u.w / u.h;

  var p = uv * 2.0 - 1.0;
  p.x *= aspect;

  let mouse = vec2f(u.mx * 2.0 - 1.0, (1.0 - u.my) * 2.0 - 1.0);

  var col = vec3f(0.0);

  // fake particle layers (cheap)
  for (var i = 0; i < 3; i = i + 1) {

    let fi = f32(i);

    // grid id
    let scale = 8.0 + fi * 6.0;
    var gp = p * scale;

    let id = floor(gp);
    let cell = fract(gp) - 0.5;

    // random offset per cell
    let rnd = hash(id + fi * 10.0);

    let angle = rnd * 6.28318 + t * (0.5 + rnd);
    let offset = vec2f(cos(angle), sin(angle)) * 0.3;

    var pos = cell - offset;

    // mouse attraction
    let dMouse = length((id/scale) - mouse);
    let attract = 1.0 / (1.0 + dMouse * 10.0);
    pos -= normalize(pos) * attract * 0.3;

    let d = length(pos);

    // particle glow
    let glow = exp(-d * 20.0);

    // color
    let c = palette(rnd + fi * 0.2 + t * 0.2);

    col += c * glow * (0.6 + fi * 0.4);
  }

  // click explosion
  let r = length(p - mouse);
  let burst = sin(r * 30.0 - t * 10.0) * exp(-r * 4.0) * u.down;
  col += vec3f(1.0, 0.8, 0.5) * burst;

  // center glow
  col += vec3f(1.0) * exp(-length(p) * 4.0) * 0.2;

  // tone mapping
  col = col / (1.0 + col);

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
            title="Rainbow Particle Field"
            hint="Move mouse to attract particles. Click to explode energy."
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