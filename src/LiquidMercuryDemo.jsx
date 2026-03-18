import { useEffect, useRef, useState } from "react"
import { useWebGPU } from "./WebGPUContext.jsx"
import {
    DemoShell,
    configureCanvasSize,
    fullscreenPipeline,
    startLoop,
    usePointer,
} from "./webgpuCommon.jsx"

export default function LiquidMercuryDemo() {
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
  time: f32,
  w: f32,
  h: f32,
  mx: f32,
  my: f32,
  mdx: f32,
  mdy: f32,
  down: f32,
};
@group(0) @binding(0) var<uniform> u: U;

// ── Noise function ──────────────────────────────────────
fn hash(p: vec2f) -> f32 {
  var q = fract(p * vec2f(127.1, 311.7));
  q += dot(q, q + 19.19);
  return fract(q.x * q.y);
}

fn fbm(p: vec2f) -> f32 {
  var v = 0.0;
  var a = 0.5;
  var pp = p;
  for(var i=0;i<5;i++){
    v += a * hash(pp);
    pp *= 2.2;
    a *= 0.5;
  }
  return v;
}

// ── Liquid mercury shading ─────────────────────────────
fn mercuryColor(dist: f32, wave: f32) -> vec3f {
  let base = vec3f(0.6,0.6,0.65)
  let highlight = vec3f(1.0,1.0,1.05)
  return mix(base, highlight, smoothstep(0.0,0.3,1.0-dist+wave*0.3))
}

// ── Main ───────────────────────────────────────────────
@fragment
fn fsMain(@location(0) uv: vec2f) -> @location(0) vec4f {
  let t = u.time
  let mouse = vec2f(u.mx, u.my)
  let mDist = length(uv - mouse)
  let ripple = exp(-mDist*mDist*30.0)*(0.5 + 0.5*sin(t*8.0 - mDist*20.0))
  let mEffect = ripple*(u.down*1.0 + 0.2)

  // Flowing liquid waves
  let pos = uv * vec2f(3.0,1.5) + vec2f(fbm(uv*3.0+t), fbm(uv*5.0-t))
  let wave = fbm(pos + mEffect*2.0)

  let distToCenter = length(uv - vec2f(0.5,0.5))
  var col = mercuryColor(distToCenter, wave)

  // subtle edge glow
  col += 0.1 * vec3f(1.0,1.0,1.0) * smoothstep(0.48,0.5,distToCenter)

  // tone map & gamma
  col = col / (col + vec3f(1.0)) * 1.5
  col = pow(max(col, vec3f(0.0)), vec3f(1.0/2.2))

  return vec4f(col, 1.0)
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
            title="Liquid Mercury Stream"
            hint="Move mouse to create ripples in the liquid metal. Click to intensify the flow."
            error={error ?? gpuError}
        >
            <canvas ref={canvasRef} width={1920} height={1080} style={{ width: '100%', height: '100%', display: 'block' }} className="demo-canvas" />
        </DemoShell>
    )
}