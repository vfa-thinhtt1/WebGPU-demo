import { useEffect, useRef, useState } from "react"
import { useWebGPU } from "./WebGPUContext.jsx"
import {
    DemoShell,
    configureCanvasSize,
    fullscreenPipeline,
    startLoop,
    usePointer,
} from "./webgpuCommon.jsx"

export default function CosmicJellyfishDemo() {
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
                    context = canvas.getContext('webgpu')
                    context.configure({ device, format, alphaMode: 'premultiplied' })
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

fn hash(p: vec2f) -> f32 {
  var q = fract(p * vec2f(127.1, 311.7));
  q += dot(q,q+19.19);
  return fract(q.x * q.y);
}

fn noise(p: vec2f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f*f*(3.0-2.0*f);
  return mix(mix(hash(i), hash(i+vec2f(1.0,0.0)), u.x),
             mix(hash(i+vec2f(0.0,1.0)), hash(i+vec2f(1.0,1.0)), u.x),
             u.y);
}

fn fbm(p: vec2f) -> f32 {
  var v = 0.0;
  var a = 0.5;
  var pp = p;
  for(var i=0;i<5;i++){
    v += a*noise(pp);
    pp *= 2.2;
    a *= 0.5;
  }
  return v;
}

fn jellyTentacle(uv: vec2f, t: f32, idx: f32, mouse: vec2f) -> vec3f {
  let base = vec2f(0.5 + 0.3*sin(idx*6.0+t*0.5), 0.2 + idx*0.1);
  let dir = uv - base;
  let dist = length(dir);
  let angle = atan2(dir.y, dir.x) + t*1.2 + idx;
  let ripple = sin(10.0*dist - t*3.0 + idx*2.0) * 0.02;
  let pulse = 0.3 + 0.3*sin(t*5.0 + idx*3.0);
  let glow = exp(-dist*10.0) * pulse;

  let mx = mouse.x;
  let my = mouse.y;
  let mdist = length(uv - vec2f(mx,my));
  let mglow = exp(-mdist*30.0);

  let r = 0.2 + glow*0.8 + mglow*0.3;
  let g = 0.3 + glow*0.6 + mglow*0.5;
  let b = 0.6 + glow*0.9 + mglow*0.7;
  return vec3f(r,g,b);
}

@fragment
fn fsMain(@location(0) uv: vec2f) -> @location(0) vec4f {
  let t = u.time;
  let mouse = vec2f(u.mx, u.my);

  var col = vec3f(0.0, 0.0, 0.05); // deep space background

  // multiple jellyfish tentacles
  for(var i=0;i<7;i++){
    col += jellyTentacle(uv, t, f32(i), mouse);
  }

  // subtle twinkling stars
  let starLayer = fbm(uv*150.0 + t*0.1);
  col += vec3f(starLayer*0.08);

  // tone map & gamma
  col = col / (col + vec3f(1.0));
  col = pow(max(col, vec3f(0.0)), vec3f(1.0/2.2));

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
            title="Cosmic Jellyfish"
            hint="Move mouse to interact with glowing jellyfish tentacles."
            error={error ?? gpuError}
        >
            <canvas ref={canvasRef} width={1920} height={1080} style={{ width: '100%', height: '100%', display: 'block' }} className="demo-canvas" />
        </DemoShell>
    )
}