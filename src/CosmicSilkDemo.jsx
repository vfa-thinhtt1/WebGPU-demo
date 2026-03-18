import { useEffect, useRef, useState } from "react"
import { useWebGPU } from "./WebGPUContext.jsx"
import {
    DemoShell,
    configureCanvasSize,
    fullscreenPipeline,
    startLoop,
    usePointer,
} from "./webgpuCommon.jsx"

export default function CosmicSilkDemo() {
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

// ─── Silk Waves ───────────────────────────────

fn silk(p: vec2f, t: f32) -> f32 {
  var v = 0.0;

  v += sin(p.x * 3.0 + t);
  v += sin(p.y * 4.0 - t * 1.2);
  v += sin((p.x + p.y) * 2.5 + t * 0.7);
  v += sin(length(p) * 5.0 - t * 1.5);

  return v / 4.0;
}

// ─── Main ─────────────────────────────────────

@fragment
fn fsMain(@location(0) uv: vec2f) -> @location(0) vec4f {
  let aspect = u.w / u.h;
  var p = (uv - 0.5) * vec2f(aspect, 1.0);

  let t = u.time;

  // mouse gravity distortion
  let m = (vec2f(u.mx, u.my) - 0.5) * vec2f(aspect, 1.0);
  let d = length(p - m);

  p += normalize(p - m) * 0.4 / (d + 0.2);

  // click ripple (time tear)
  let ripple = sin(20.0 * (d - t * 0.5)) * exp(-3.0 * d);
  p += normalize(p - m) * ripple * u.down;

  // silk pattern
  let s = silk(p, t);

  // gradient colors (cosmic fabric)
  var col = vec3f(
    0.5 + 0.5 * cos(s * 3.0 + t * 0.5),
    0.5 + 0.5 * cos(s * 3.0 + t * 0.5 + 2.0),
    0.5 + 0.5 * cos(s * 3.0 + t * 0.5 + 4.0)
  );

  // lighting illusion (fake normals)
  let eps = 0.002;
  let dx = silk(p + vec2f(eps, 0.0), t) - s;
  let dy = silk(p + vec2f(0.0, eps), t) - s;

  let normal = normalize(vec3f(-dx, -dy, 1.0));
  let light = normalize(vec3f(-0.4, 0.6, 1.0));

  let diff = dot(normal, light) * 0.5 + 0.5;
  col *= diff;

  // glow lines
  let lines = smoothstep(0.4, 0.45, abs(s));
  col += vec3f(0.8, 0.9, 1.0) * lines * 0.6;

  // vignette
  let vignette = smoothstep(1.2, 0.2, length(p));
  col *= vignette;

  // tone map
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
            title="Cosmic Silk / Time Fabric"
            hint="Move mouse to bend space. Click to tear reality."
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