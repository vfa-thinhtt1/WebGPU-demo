import { useEffect, useRef, useState } from "react"
import { useWebGPU } from "./WebGPUContext.jsx"
import {
    DemoShell,
    configureCanvasSize,
    fullscreenPipeline,
    startLoop,
    usePointer,
} from "./webgpuCommon.jsx"

export default function NeuralFluxDemo() {
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
  return fract(sin(dot(p, vec2f(127.1,311.7)))*43758.5453);
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
  for(var i=0;i<5;i++){
    v += a*noise(pp);
    pp *= 2.2;
    a *= 0.5;
  }
  return v;
}

fn filamentColor(angle: f32, idx: f32) -> vec3f {
  let hue = fract(angle + idx*0.618);
  if(hue < 0.33){
    return vec3f(1.0,0.2,0.7);
  } else if(hue < 0.66){
    return vec3f(0.2,1.0,0.5);
  } else {
    return vec3f(0.2,0.5,1.0);
  }
}

@fragment
fn fsMain(@location(0) uv: vec2f) -> @location(0) vec4f {
  let t = u.time;
  let mouse = vec2f(u.mx, u.my);
  var col = vec3f(0.0,0.0,0.0);

  // central neural flux
  let center = vec2f(0.5,0.5);
  let toCenter = uv - center;
  let radius = length(toCenter);
  let angle = atan2(toCenter.y,toCenter.x);

  // twisting filaments
  for(var i=0.0;i<20.0;i++){
    let freq = 1.5 + i*0.1;
    let phase = t*0.5 + i*0.3;
    let x = sin(angle*freq + phase + fbm(uv*5.0))*0.05;
    let y = cos(angle*freq + phase + fbm(uv*7.0))*0.05;
    let pos = center + vec2f(x,y) + toCenter*0.8;

    // repel from mouse
    let toMouse = pos - mouse;
    let mDist = length(toMouse);
    let repel = normalize(toMouse) * clamp(0.15 - mDist,0.0,0.15);
    let finalPos = pos + repel*0.2;

    let distP = length(uv - finalPos);
    col += filamentColor(angle, i) * exp(-distP*18.0);
  }

  // dynamic plasma background
  col += vec3f(fbm(uv*8.0+t*0.2), fbm(uv*12.0-t*0.3), fbm(uv*16.0+t*0.4))*0.08;

  // subtle sparkling effect
  col += vec3f(fbm(uv*200.0+t*0.05)*0.03);

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
            title="Psychedelic Neural Flux"
            hint="Move your mouse to interact with twisting neon filaments."
            error={error ?? gpuError}
        >
            <canvas ref={canvasRef} width={1920} height={1080} style={{ width: '100%', height: '100%', display: 'block' }} className="demo-canvas" />
        </DemoShell>
    )
}