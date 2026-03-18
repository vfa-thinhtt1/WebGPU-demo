import { useEffect, useRef, useState } from "react"
import { useWebGPU } from "./WebGPUContext.jsx"
import {
    DemoShell,
    configureCanvasSize,
    fullscreenPipeline,
    startLoop,
    usePointer,
} from "./webgpuCommon.jsx"

export default function ElectricCoreDemo() {
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

                    const uniformBuffer = device.createBuffer({
                        size: 4 * 12,
                        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
                    })

                    const pipeline = fullscreenPipeline({
                        device,
                        format,
                        fragmentCode: /* wgsl */ `

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

// ─── Hash ─────────────────────────────

fn hash(p: vec2f) -> f32 {
  return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453);
}

// ─── Electric Arc ─────────────────────

fn arc(p: vec2f, t: f32) -> f32 {
  var v = 0.0;
  var freq = 1.0;
  var amp = 1.0;

  for (var i = 0; i < 4; i++) {
    let n = hash(floor(p * freq + t));
    v += abs(n - 0.5) * amp;
    freq *= 2.0;
    amp *= 0.5;
  }

  return v;
}

// ─── Main ─────────────────────────────

@fragment
fn fsMain(@location(0) uv: vec2f) -> @location(0) vec4f {
  let aspect = u.w / u.h;
  var p = (uv - 0.5) * vec2f(aspect, 1.0);

  let t = u.time;

  // polar coords
  let r = length(p);
  var a = atan2(p.y, p.x);

  // rotating rings
  a += t * 0.5;

  // mouse distortion
  let m = (vec2f(u.mx, u.my) - 0.5) * vec2f(aspect, 1.0);
  let dMouse = length(p - m);
  p += normalize(p - m) * 0.3 / (dMouse + 0.1);

  // layered arcs
  var energy = 0.0;

  for (var i = 0; i < 5; i++) {
    let fi = f32(i);

    let ring = abs(r - (0.2 + fi * 0.15));
    let arcVal = arc(vec2f(a * 3.0, r * 5.0 + fi + t), t);

    let line = smoothstep(0.02, 0.0, ring + arcVal * 0.05);

    energy += line * (1.0 - fi * 0.15);
  }

  // central core glow
  let core = exp(-10.0 * r);

  // click overload pulse
  let pulse = sin(30.0 * (r - t * 2.0)) * exp(-6.0 * r) * u.down;

  // color
  var col = vec3f(0.0);

  // electric blue base
  col += vec3f(0.1, 0.5, 1.0) * energy * 2.0;

  // white hot core
  col += vec3f(1.0, 0.9, 0.7) * core * 2.5;

  // pulse flash
  col += vec3f(0.8, 0.9, 1.0) * pulse * 2.0;

  // ambient glow
  col += energy * 0.3;

  // vignette
  let vignette = smoothstep(1.2, 0.2, r);
  col *= vignette;

  // tone mapping
  col = col / (col + vec3f(1.0));
  col = pow(col, vec3f(1.0 / 2.2));

  return vec4f(col, 1.0);
}
`,
                    })

                    const bindGroup = device.createBindGroup({
                        layout: pipeline.getBindGroupLayout(0),
                        entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
                    })

                    const onResize = () =>
                        configureCanvasSize(canvas, context, device, format)
                    onResize()
                    window.addEventListener("resize", onResize)

                    stop = startLoop((time) => {
                        const ptr = pointerRef.current
                        const { width, height } = configureCanvasSize(
                            canvas,
                            context,
                            device,
                            format
                        )

                        device.queue.writeBuffer(
                            uniformBuffer,
                            0,
                            new Float32Array([
                                time,
                                width,
                                height,
                                ptr.x,
                                1 - ptr.y,
                                ptr.dx,
                                -ptr.dy,
                                ptr.down ? 1 : 0,
                                0,
                                0,
                                0,
                                0,
                            ])
                        )

                        const encoder = device.createCommandEncoder()
                        const pass = encoder.beginRenderPass({
                            colorAttachments: [
                                {
                                    view: context.getCurrentTexture().createView(),
                                    clearValue: { r: 0, g: 0, b: 0, a: 1 },
                                    loadOp: "clear",
                                    storeOp: "store",
                                },
                            ],
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
            try {
                context?.unconfigure()
            } catch (_) { }
        }
    }, [gpuState, pointerRef])

    return (
        <DemoShell
            title="Electric Core Reactor ⚡"
            hint="Move mouse to destabilize the core. Click to overload energy."
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