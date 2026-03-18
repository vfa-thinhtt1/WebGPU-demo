import { useEffect, useRef, useState } from "react"
import { useWebGPU } from "./WebGPUContext.jsx"
import {
    DemoShell,
    configureCanvasSize,
    fullscreenPipeline,
    startLoop,
    usePointer,
} from "./webgpuCommon.jsx"

export default function CrystalTimeFracture() {
    const canvasRef = useRef(null)
    const pointerRef = usePointer(canvasRef)
    const { gpuState, error: gpuError } = useWebGPU()
    const [error, setError] = useState(null)

    useEffect(() => {
        if (!gpuState) return

        const { device, format } = gpuState
        const canvas = canvasRef.current
        if (!canvas) return

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

// ── Folding space (kaleidoscope) ─────────────────────

fn fold(p: vec3f) -> vec3f {
  var q = p;

  for (var i = 0; i < 5; i++) {
    q = abs(q);
    if (q.x < q.y) { let tmp = q.x; q.x = q.y; q.y = tmp; }
    if (q.x < q.z) { let tmp = q.x; q.x = q.z; q.z = tmp; }
    q = q * 1.3 - 0.5;
  }

  return q;
}

// ── Distance field ───────────────────────────────────

fn map(p_in: vec3f) -> f32 {
  var p = p_in;

  let t = u.time * 0.7;

  // time fracture (temporal snapping)
  let glitch = step(0.5, fract(t * 0.5));
  p += glitch * 0.2 * sin(p * 5.0 + t);

  // mouse distortion
  let m = (vec2f(u.mx, u.my) - 0.5) * 2.0;
  let dMouse = length(p.xy - m);
  p.xy += normalize(p.xy - m) * 0.4 / (dMouse + 0.2);

  // fold space
  p = fold(p);

  // crystalline structure
  let d = length(p) - 0.3;

  // pulse burst
  let pulse = exp(-20.0 * abs(length(p_in) - fract(u.time))) * u.down;

  return d - pulse * 0.3;
}

// ── Normal ───────────────────────────────────────────

fn normal(p: vec3f) -> vec3f {
  let e = vec2f(0.001, 0.0);
  return normalize(vec3f(
    map(p + e.xyy) - map(p - e.xyy),
    map(p + e.yxy) - map(p - e.yxy),
    map(p + e.yyx) - map(p - e.yyx)
  ));
}

// ── Rendering ────────────────────────────────────────

@fragment
fn fsMain(@location(0) uv: vec2f) -> @location(0) vec4f {
  let aspect = u.w / u.h;
  let p = (uv - 0.5) * vec2f(aspect, 1.0);

  let ro = vec3f(0.0, 0.0, 2.5);
  let rd = normalize(vec3f(p, -1.2));

  var t = 0.0;
  var col = vec3f(0.0);
  var hit = false;

  for (var i = 0; i < 60; i++) {
    let pos = ro + rd * t;
    let d = map(pos);

    if (d < 0.001) {
      hit = true;
      break;
    }

    t += d * 0.7;
    if (t > 8.0) { break; }
  }

  if (hit) {
    let pos = ro + rd * t;
    let n = normal(pos);

    // refractive-like color
    let fres = pow(1.0 + dot(rd, n), 3.0);

    let base = vec3f(
      0.3 + 0.7 * sin(pos.x * 3.0 + u.time),
      0.5 + 0.5 * cos(pos.y * 4.0),
      1.0
    );

    col = base * 0.6 + fres * vec3f(0.8, 0.9, 1.0);

    // sharp crystal edges
    col *= 0.7 + 0.3 * abs(n);
  } else {
    // deep space background
    let bg = vec3f(0.01, 0.02, 0.05) + 0.02 * sin(vec3f(0.0,1.0,2.0) + u.time);
    col = bg;
  }

  // tone mapping
  col = col / (col + vec3f(1.0));
  col = pow(col, vec3f(0.4545));

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
                                0, 0, 0, 0
                            ])
                        )

                        const encoder = device.createCommandEncoder()
                        const pass = encoder.beginRenderPass({
                            colorAttachments: [{
                                view: context.getCurrentTexture().createView(),
                                clearValue: { r: 0, g: 0, b: 0, a: 1 },
                                loadOp: "clear",
                                storeOp: "store",
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
            stop()
            try { context?.unconfigure() } catch (_) { }
        }
    }, [gpuState, pointerRef])

    return (
        <DemoShell
            title="Crystal Time Fracture"
            hint="Move mouse = bend fracture center. Click = trigger time glitch burst."
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