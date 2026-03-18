import { useEffect, useRef, useState } from "react"
import { useWebGPU } from "./WebGPUContext.jsx"
import {
    DemoShell,
    configureCanvasSize,
    fullscreenPipeline,
    startLoop,
    usePointer,
} from "./webgpuCommon.jsx"

export default function MirrorTunnelDemo() {
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

// ─── Rotation ────────────────────────────────

fn rot(a: f32) -> mat2x2<f32> {
  return mat2x2<f32>(
    cos(a), -sin(a),
    sin(a), cos(a)
  );
}

// ─── Tunnel Mapping ──────────────────────────

fn tunnel(p: vec2f, t: f32) -> vec2f {
  var uv = p;

  // fold space repeatedly (mirror effect)
  for (var i = 0; i < 4; i++) {
    uv = abs(uv) - 0.5;
    uv *= rot(0.5 + t * 0.1);
  }

  return uv;
}

// ─── Main ────────────────────────────────────

@fragment
fn fsMain(@location(0) uv: vec2f) -> @location(0) vec4f {
  let aspect = u.w / u.h;
  var p = (uv - 0.5) * vec2f(aspect, 1.0);

  let t = u.time;

  // mouse bends tunnel center
  let m = (vec2f(u.mx, u.my) - 0.5) * vec2f(aspect, 1.0);
  p -= m * 0.7;

  // zoom into tunnel
  var depth = 0.0;
  var col = vec3f(0.0);

  for (var i = 0; i < 40; i++) {
    let z = f32(i) * 0.05;

    var tp = p / (1.0 + z * 2.0);

    tp = tunnel(tp, t);

    let d = length(tp);

    // ring pulse on click
    let pulse = sin(20.0 * (d - t * 0.5)) * exp(-6.0 * d) * u.down;

    // color shifting with depth
    let c = vec3f(
      0.5 + 0.5 * cos(z * 4.0 + t),
      0.5 + 0.5 * cos(z * 4.0 + t + 2.0),
      0.5 + 0.5 * cos(z * 4.0 + t + 4.0)
    );

    let intensity = smoothstep(0.4, 0.0, d);

    col += c * intensity * 0.04;
    col += vec3f(1.0, 0.8, 0.5) * pulse * 0.1;

    depth += intensity * 0.02;
  }

  // glow core
  col += vec3f(0.6, 0.9, 1.0) * depth * 1.5;

  // vignette
  let vignette = smoothstep(1.2, 0.3, length(p));
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
            title="Infinite Mirror Tunnel 🪞"
            hint="Move mouse to bend the tunnel. Click to send a pulse through space."
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