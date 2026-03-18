import { useEffect, useRef, useState } from "react"
import { useWebGPU } from "./WebGPUContext.jsx"
import {
    DemoShell,
    configureCanvasSize,
    fullscreenPipeline,
    startLoop,
    usePointer,
} from "./webgpuCommon.jsx"

export default function NeonParticleTornadoDemo() {
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

// simple pseudo-random
fn hash(p: vec2f) -> f32 {
  return fract(sin(dot(p, vec2f(127.1,311.7))) * 43758.5453);
}

// fractional brownian motion
fn fbm(p: vec2f) -> f32 {
  var v = 0.0;
  var a = 0.5;
  var pp = p;
  for(var i=0;i<5;i++){
    v += a*hash(pp);
    pp *= 2.3;
    a *= 0.5;
  }
  return v;
}

// generate particle color
fn particleColor(idx: f32, dist: f32, t: f32) -> vec3f {
  let hue = fract(idx*0.618 + t*0.1);
  var col: vec3f;
  if(hue < 0.33){
    col = vec3f(1.0,0.2,0.6); // pink
  } else if(hue < 0.66){
    col = vec3f(0.2,1.0,0.5); // green
  } else {
    col = vec3f(0.2,0.5,1.0); // blue
  }
  return col * exp(-dist*12.0);
}

@fragment
fn fsMain(@location(0) uv: vec2f) -> @location(0) vec4f {
  let t = u.time;
  let mouse = vec2f(u.mx, u.my);
  var col = vec3f(0.0,0.0,0.0); // black background

  let center = vec2f(0.5,0.5);
  let toCenter = uv - center;
  let radius = length(toCenter);

  // background swirling plasma
  col += vec3f(fbm(uv*5.0+t*0.2),
               fbm(uv*7.0-t*0.3),
               fbm(uv*11.0+t*0.4))*0.1;

  // particles in tornado
  let NUM_PARTICLES = 100.0;
  for(var i=0.0; i<NUM_PARTICLES; i++){
    let angle = t*2.0 + i*0.628;
    let radiusP = fract(i/NUM_PARTICLES) * 0.4 + 0.05;
    let pos = center + vec2f(radiusP*cos(angle+radius*5.0), radiusP*sin(angle+radius*5.0));

    // repel particles from mouse
    let toMouse = pos - mouse;
    let mdist = length(toMouse);
    let repel = normalize(toMouse) * clamp(0.15 - mdist, 0.0, 0.15);
    let finalPos = pos + repel*0.2;

    let distP = length(uv - finalPos);
    col += particleColor(i, distP, t);
  }

  // subtle stars
  col += vec3f(fbm(uv*100.0+t*0.05)*0.05);

  // gamma
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
            title="Neon Particle Tornado"
            hint="Move your mouse to interact with the neon particles swirling in a tornado."
            error={error ?? gpuError}
        >
            <canvas ref={canvasRef} width={1920} height={1080} style={{ width: '100%', height: '100%', display: 'block' }} className="demo-canvas" />
        </DemoShell>
    )
}