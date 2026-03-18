import { useEffect, useRef, useState } from "react"
import { useWebGPU } from "./WebGPUContext.jsx"
import {
    DemoShell,
    configureCanvasSize,
    fullscreenPipeline,
    startLoop,
    usePointer,
} from "./webgpuCommon.jsx"

export default function BlackHoleWarpDemo() {
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

// ── helpers ─────────────────────────────

fn hash(p: vec2f) -> f32 {
  let h = dot(p, vec2f(127.1, 311.7));
  return fract(sin(h) * 43758.5453);
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

fn fbm(p: vec2f) -> f32 {
  var v = 0.0;
  var a = 0.5;
  var pp = p;
  for (var i = 0; i < 5; i++) {
    v += a * noise(pp);
    pp *= 2.0;
    a *= 0.5;
  }
  return v;
}

// ── main ───────────────────────────────

@fragment
fn fsMain(@location(0) uv: vec2f) -> @location(0) vec4f {

  let t = u.time;
  let aspect = u.w / u.h;

  var p = uv * 2.0 - 1.0;
  p.x *= aspect;

  let mouse = vec2f(u.mx * 2.0 - 1.0, (1.0 - u.my) * 2.0 - 1.0);
  let center = mouse;

  var d = length(p - center);

  // ── gravitational lensing ──
  let lens = 0.15 / (d + 0.05);
  p += normalize(p - center) * lens * 0.2;

  // ── swirl rotation ──
  let angle = atan2(p.y - center.y, p.x - center.x);
  let radius = length(p - center);

  let swirl = angle + 2.0 / (radius + 0.2) + t * 0.3;

  let diskUV = vec2f(cos(swirl), sin(swirl)) * radius;

  // ── accretion disk ──
  let disk = exp(-radius * 2.5);

  let turbulence = fbm(diskUV * 6.0 + t * 0.5);

  let heat = disk * (0.6 + turbulence * 0.8);

  // ── color ──
  let colHot = vec3f(1.0, 0.8, 0.3);
  let colMid = vec3f(1.0, 0.3, 0.1);
  let colDark = vec3f(0.02, 0.02, 0.05);

  var col = mix(colDark, colMid, heat);
  col = mix(col, colHot, pow(heat, 3.0));

  // ── black hole core ──
  let hole = smoothstep(0.0, 0.08, radius);
  col *= hole;

  // ── energy jet (vertical beam) ──
  let jet = exp(-abs(p.x - center.x) * 20.0) * exp(-radius * 2.0);
  col += vec3f(0.4, 0.6, 1.0) * jet * 0.6;

  // ── mouse click = spacetime burst ──
  let burst = exp(-d * 8.0) * u.down * (0.5 + 0.5 * sin(t * 10.0));
  col += vec3f(1.0, 1.0, 1.0) * burst;

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
            title="Black Hole Warp"
            hint="Move mouse to bend spacetime. Click to inject energy."
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