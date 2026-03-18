import { useEffect, useRef, useState } from "react"
import { useWebGPU } from "./WebGPUContext.jsx"
import {
    DemoShell,
    configureCanvasSize,
    fullscreenPipeline,
    startLoop,
    usePointer,
} from "./webgpuCommon.jsx"

export default function LiquidVortexDemo() {
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

fn hash2(p: vec2f) -> f32 {
  var q = fract(p * vec2f(127.1, 311.7));
  q += dot(q, q + 19.19);
  return fract(q.x * q.y);
}

fn vnoise(p: vec2f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u2 = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash2(i + vec2f(0,0)), hash2(i + vec2f(1,0)), u2.x),
    mix(hash2(i + vec2f(0,1)), hash2(i + vec2f(1,1)), u2.x),
    u2.y
  );
}

fn fbm(p_in: vec2f, oct: i32) -> f32 {
  var v = 0.0;
  var a = 0.5;
  var pp = p_in;
  for (var i = 0; i < oct; i++) {
    v += a * vnoise(pp);
    pp *= 2.3;
    a *= 0.5;
  }
  return v;
}

fn vortexColor(d: f32) -> vec3f {
  let center = vec3f(0.0, 0.3, 0.6);
  let mid    = vec3f(0.2, 0.6, 0.9);
  let glow   = vec3f(0.5, 1.0, 1.0);
  if (d < 0.5) { return mix(center, mid, d / 0.5); }
  else { return mix(mid, glow, (d-0.5)/0.5); }
}

fn mouseRipple(uv: vec2f, mouse: vec2f, t: f32, down: f32) -> f32 {
  let d = length(uv - mouse);
  let ripple = sin(10.0*d - t*5.0) * exp(-d*15.0);
  let click   = exp(-d*d*40.0) * down;
  return max(ripple*0.2 + click, 0.0);
}

@fragment
fn fsMain(@location(0) uv: vec2f) -> @location(0) vec4f {
  let aspect = u.w / u.h;
  let t = u.time;
  // slight jitter to avoid line artifact
  let uvA = uv * vec2f(aspect,1.0) - vec2f(aspect*0.5,0.5) + 0.0001;

  // radial vortex flow
  let r = length(uvA);
  let angle = atan2(uvA.y, uvA.x);
  let flow = fbm(vec2f(r*3.0 + t*0.2, angle*2.0), 5);

  // mouse interaction
  let mouse = vec2f(u.mx*aspect, u.my);
  let ripple = mouseRipple(uv*vec2f(aspect,1.0), mouse, t, u.down);

  let d = clamp(flow*0.5 + 0.5 + ripple, 0.0, 1.0);

  var col = vortexColor(d);

  // shimmer highlights
  col += vec3f(0.2,0.4,0.6) * fbm(uvA*8.0 + vec2f(t*0.3, -t*0.2), 3) * 0.1;

  // subtle vignette (adjusted smoothstep to remove line)
  let vig = 1.0 - smoothstep(0.401, 0.801, r*1.5);
  col *= 0.6 + 0.4*vig;

  return vec4f(col,1.0);
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
                            ptr.x, 1 - ptr.y, ptr.dx, -ptr.dy, ptr.down ? 1 : 0,
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
            title="Liquid Vortex"
            hint="Move mouse to stir the vortex. Click to generate splashes."
            error={error ?? gpuError}
        >
            <canvas ref={canvasRef} width={1920} height={1080} style={{ width: '100%', height: '100%', display: 'block' }} className="demo-canvas" />
        </DemoShell>
    )
}