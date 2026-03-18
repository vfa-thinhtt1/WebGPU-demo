import { useEffect, useRef, useState } from "react"
import { useWebGPU } from "./WebGPUContext.jsx"
import {
    DemoShell,
    configureCanvasSize,
    fullscreenPipeline,
    startLoop,
    usePointer,
} from "./webgpuCommon.jsx"

export default function ElectricGridDemo() {
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

// ─── Node positions ───────────────────

fn node(id: f32) -> vec2f {
  let x = hash(vec2f(id, 1.0));
  let y = hash(vec2f(id, 2.0));
  return vec2f(x, y) * 2.0 - 1.0;
}

// ─── Distance to segment ──────────────

fn lineDist(p: vec2f, a: vec2f, b: vec2f) -> f32 {
  let pa = p - a;
  let ba = b - a;
  let h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h);
}

// ─── Main ─────────────────────────────

@fragment
fn fsMain(@location(0) uv: vec2f) -> @location(0) vec4f {
  let aspect = u.w / u.h;
  var p = (uv - 0.5) * vec2f(aspect, 1.0);

  let t = u.time;

  // mouse attractor
  let m = (vec2f(u.mx, u.my) - 0.5) * vec2f(aspect, 1.0);

  var col = vec3f(0.0);

  let N = 12.0;

  // nodes glow
  for (var i = 0; i < i32(N); i++) {
    let id = f32(i);
    var n = node(id);

    // animate nodes slightly
    n += vec2f(
      sin(t + id),
      cos(t * 0.8 + id)
    ) * 0.1;

    let d = length(p - n);

    // node glow
    let glow = exp(-20.0 * d);
    col += vec3f(0.4, 0.8, 1.0) * glow;

    // click inject energy
    let inject = exp(-10.0 * length(n - m)) * u.down;
    col += vec3f(1.0, 0.9, 0.6) * inject * 2.0;
  }

  // connections
  for (var i = 0; i < i32(N); i++) {
    for (var j = i + 1; j < i + 3; j++) {
      let id1 = f32(i);
      let id2 = f32(j % i32(N));

      var a = node(id1);
      var b = node(id2);

      a += vec2f(sin(t + id1), cos(t + id1)) * 0.1;
      b += vec2f(sin(t + id2), cos(t + id2)) * 0.1;

      let d = lineDist(p, a, b);

      // electric pulse along line
      let pulse = sin(10.0 * (d + t + id1)) * 0.5 + 0.5;

      let line = smoothstep(0.02, 0.0, d);

      col += vec3f(0.2, 0.6, 1.0) * line * pulse;
    }
  }

  // mouse influence (reroute energy)
  let dMouse = length(p - m);
  col += vec3f(0.5, 0.8, 1.0) * exp(-6.0 * dMouse);

  // background
  col += vec3f(0.02, 0.02, 0.05);

  // vignette
  let vignette = smoothstep(1.2, 0.2, length(p));
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
            title="Neural Electric Grid ⚡🧠"
            hint="Move mouse to attract current. Click to inject energy."
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