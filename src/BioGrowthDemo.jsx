import { useEffect, useRef, useState } from "react"
import { useWebGPU } from "./WebGPUContext.jsx"
import {
    DemoShell,
    configureCanvasSize,
    fullscreenPipeline,
    startLoop,
    usePointer,
} from "./webgpuCommon.jsx"

export default function BioGrowthDemo() {
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

// ─── Hash / Noise ─────────────────────────────

fn hash(p: vec2f) -> f32 {
  return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453);
}

fn noise(p: vec2f) -> f32 {
  let i = floor(p);
  let f = fract(p);

  let u = f * f * (3.0 - 2.0 * f);

  return mix(
    mix(hash(i), hash(i + vec2f(1,0)), u.x),
    mix(hash(i + vec2f(0,1)), hash(i + vec2f(1,1)), u.x),
    u.y
  );
}

// ─── Organic Pattern ──────────────────────────

fn pattern(p: vec2f, t: f32) -> f32 {
  var v = 0.0;
  var scale = 1.0;

  for (var i = 0; i < 5; i++) {
    let n = noise(p * scale + t * 0.1);
    v += sin(n * 6.2831) / scale;

    scale *= 2.0;
  }

  return v;
}

// ─── Main ─────────────────────────────────────

@fragment
fn fsMain(@location(0) uv: vec2f) -> @location(0) vec4f {
  let aspect = u.w / u.h;
  var p = (uv - 0.5) * vec2f(aspect, 1.0);

  let t = u.time * 0.8;

  // slow organic drift
  p += vec2f(
    sin(p.y * 1.5 + t),
    cos(p.x * 1.5 - t)
  ) * 0.2;

  // mouse = growth source
  let m = (vec2f(u.mx, u.my) - 0.5) * vec2f(aspect, 1.0);
  let dMouse = length(p - m);

  let feed = exp(-6.0 * dMouse);
  p += normalize(p - m) * feed * 0.3;

  // base pattern
  let v = pattern(p * 2.5, t);

  // threshold creates "cells"
  var cells = smoothstep(0.1, 0.2, v);

  // click burst = mutation
  let mutation = exp(-10.0 * dMouse) * u.down;
  cells += mutation;

  // veins detail
  let veins = smoothstep(0.0, 0.05, abs(v));

  // coloring (bio-organic)
  var col = vec3f(0.0);

  col += vec3f(0.1, 0.8, 0.4) * cells;       // green body
  col += vec3f(0.8, 0.2, 0.9) * veins * 0.6; // purple veins
  col += vec3f(1.0, 0.9, 0.3) * mutation;    // energy burst

  // subtle glow
  col += cells * 0.2;

  // background
  col += vec3f(0.02, 0.03, 0.04);

  // vignette
  let vignette = smoothstep(1.3, 0.2, length(p));
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
            title="Bio Growth / Living Cells 🧪"
            hint="Move mouse to feed the organism. Click to trigger mutation."
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