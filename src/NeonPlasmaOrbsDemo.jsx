import { useEffect, useRef, useState } from "react"
import { useWebGPU } from "./WebGPUContext.jsx"
import {
    DemoShell,
    configureCanvasSize,
    fullscreenPipeline,
    startLoop,
    usePointer,
} from "./webgpuCommon.jsx"

export default function NeonPlasmaOrbsDemo() {
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
  return fract(sin(dot(p, vec2f(127.1,311.7))) * 43758.5453);
}

fn noise(p: vec2f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f*f*(3.0-2.0*f);
  return mix(mix(hash(i), hash(i+vec2f(1.0,0.0)), u.x),
             mix(hash(i+vec2f(0.0,1.0)), hash(i+vec2f(1.0,1.0)), u.x), u.y);
}

fn fbm(p: vec2f) -> f32 {
  var v = 0.0;
  var a = 0.5;
  var pp = p;
  for(var i=0;i<5;i++){ v += a*noise(pp); pp*=2.2; a*=0.5; }
  return v;
}

fn orb(uv: vec2f, center: vec2f, t: f32, idx: f32) -> vec3f {
  let dir = uv - center;
  let dist = length(dir);
  let glow = exp(-dist*15.0);

  // use distinct neon colors for each orb
  let hue = fract(idx*0.618 + t*0.05);
  var col: vec3f;
  if(hue < 0.33){
    col = vec3f(0.9, 0.2, 0.6); // pink
  } else if(hue < 0.66){
    col = vec3f(0.2, 1.0, 0.5); // green
  } else{
    col = vec3f(0.2, 0.5, 1.0); // blue
  }

  return col * glow;
}

@fragment
fn fsMain(@location(0) uv: vec2f) -> @location(0) vec4f {
  let t = u.time;
  let mouse = vec2f(u.mx, u.my);

  var col = vec3f(0.0,0.0,0.05); // dark plasma background

  // dynamic plasma pattern (subtle)
  col += vec3f(fbm(uv*3.0 + t*0.1),
               fbm(uv*5.0 - t*0.2),
               fbm(uv*7.0 + t*0.3)) * 0.1;

  // floating neon orbs
  for(var i=0;i<8;i++){
    let angle = t*0.3 + f32(i);
    let center = vec2f(0.5 + 0.3*sin(angle*1.2 + f32(i)),
                       0.5 + 0.3*cos(angle*1.5 + f32(i)));

    // repel from mouse
    let toMouse = center - mouse;
    let mDist = length(toMouse);
    let repulse = normalize(toMouse) * clamp(0.15 - mDist, 0.0, 0.15);
    col += orb(uv, center + repulse, t, f32(i));
  }

  // subtle stars
  col += vec3f(fbm(uv*100.0 + t*0.05)*0.05);

  // gamma correction
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
            title="Neon Plasma Orbs"
            hint="Move your mouse to repel the glowing orbs."
            error={error ?? gpuError}
        >
            <canvas ref={canvasRef} width={1920} height={1080} style={{ width: '100%', height: '100%', display: 'block' }} className="demo-canvas" />
        </DemoShell>
    )
}