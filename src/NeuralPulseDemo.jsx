import { useEffect, useRef, useState } from "react"
import { useWebGPU } from "./WebGPUContext.jsx"
import {
    DemoShell,
    configureCanvasSize,
    fullscreenPipeline,
    startLoop,
    usePointer,
} from "./webgpuCommon.jsx"

export default function NeuralPulseDemo() {
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

// ── fast noise ───────────────────────

fn hash(p: vec2f) -> f32 {
  return fract(sin(dot(p, vec2f(127.1,311.7))) * 43758.5453);
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

// cheaper fbm
fn fbm3(p: vec2f) -> f32 {
  var v = 0.0;
  var a = 0.5;
  var pp = p;
  for (var i = 0; i < 3; i++) {
    v += a * noise(pp);
    pp *= 2.0;
    a *= 0.5;
  }
  return v;
}

// field
fn field(p: vec2f, t: f32) -> vec2f {
  let n = noise(p * 2.0 + t * 0.2);
  let angle = n * 6.2831;
  return vec2f(cos(angle), sin(angle));
}

// fast falloff
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

  // ── optimized flow ──
  var pos = p;
  var accum = 0.0;

  for (var i = 0; i < 10; i++) {
    let dir = field(pos, t);
    pos += dir * 0.04;

    let d = length(pos - p);
    accum += falloff(d) * noise(pos * 3.0 + t);
  }

  // ── pulse ──
  let pulse = sin(accum * 5.0 - t * 3.0) * 0.5 + 0.5;

  // ── interaction ──
  let d = length(p - mouse);
  let inject = falloff(d * 2.0);
  let burst = falloff(d * 5.0) * u.down;

  let energy = accum * 0.6 + pulse * 0.7 + inject + burst * 1.5;

  // ── color ──
  let base = vec3f(0.02, 0.02, 0.05);
  let blue = vec3f(0.2, 0.5, 1.0);
  let pink = vec3f(1.0, 0.2, 0.6);

  var col = mix(base, blue, energy);
  col = mix(col, pink, pulse);
  col += vec3f(1.0) * burst;

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
            title="Neural Pulse Field"
            hint="Move mouse to inject signals. Click to trigger neuron bursts."
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