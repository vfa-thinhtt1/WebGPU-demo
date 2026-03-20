import { useEffect, useRef, useState } from "react"
import { useWebGPU } from "./WebGPUContext.jsx"
import { DemoShell, configureCanvasSize, fullscreenPipeline, startLoop, usePointer } from "./webgpuCommon.jsx"

export default function BioluminescentOrbsDemo() {
  const canvasRef  = useRef(null)
  const pointerRef = usePointer(canvasRef)
  const { gpuState, error: gpuError } = useWebGPU()
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!gpuState) return

    const { device, format } = gpuState
    const canvas = canvasRef.current
    if (!canvas) return

    let cancelled = false
    let stop    = () => {}
    let context = null

    ;(async () => {
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
          fragmentCode: /* wgsl */`

struct Uniforms {
  time: f32,
  w: f32,
  h: f32,
  mx: f32,
  my: f32,
  mdx: f32,
  mdy: f32,
  down: f32
};

@group(0) @binding(0) var<uniform> u: Uniforms;

fn sdSphere(p: vec3f, s: f32) -> f32 {
  return length(p) - s;
}

fn opSmoothUnion(d1: f32, d2: f32, k: f32) -> f32 {
    let h = clamp( 0.5 + 0.5*(d2-d1)/k, 0.0, 1.0 );
    return mix( d2, d1, h ) - k*h*(1.0-h);
}

fn map(p: vec3f) -> f32 {
  let t = u.time * 0.5;
  
  let p1 = vec3f(sin(t)*1.5, cos(t*1.3)*1.0, sin(t*0.8)*1.5);
  let p2 = vec3f(cos(t*1.1)*1.5, sin(t*0.9)*1.5, cos(t*1.5)*1.0);
  let p3 = vec3f(sin(t*0.7)*1.0, cos(t*1.4)*1.2, sin(t*1.2)*1.4);
  
  var d = sdSphere(p - p1, 0.6);
  d = opSmoothUnion(d, sdSphere(p - p2, 0.5), 0.8);
  d = opSmoothUnion(d, sdSphere(p - p3, 0.7), 0.8);
  
  let mx = (u.mx - 0.5) * 6.0;
  let my = (0.5 - u.my) * 4.0;
  let pm = vec3f(mx, my, 0.0);
  d = opSmoothUnion(d, sdSphere(p - pm, 0.4 + 0.2*sin(t*5.0)), 1.2);

  return d;
}

@fragment
fn fsMain(@location(0) uv: vec2f) -> @location(0) vec4f {
  let aspect = u.w / u.h;
  let p = (uv - 0.5) * vec2f(aspect, 1.0) * 2.0;
  
  var ro = vec3f(0.0, 0.0, -5.0);
  let rd = normalize(vec3f(p, 2.0));
  
  var t: f32 = 0.0;
  var d: f32 = 0.0;
  
  for(var i=0; i<64; i++) {
    let pos = ro + rd * t;
    d = map(pos);
    if(d < 0.01 || t > 10.0) { break; }
    t += d;
  }
  
  var col = vec3f(0.0);
  var glow = 0.0;
  var t2 = 0.0;
  
  // Accumulate glow traversing again through the sdf (cheap subsurface/glow approx)
  for(var i=0; i<40; i++) {
      let pos = ro + rd * t2;
      let dist = map(pos);
      glow += 0.08 / (0.1 + dist*dist*8.0);
      t2 += dist * 0.4 + 0.1;
      if (t2 > 10.0) { break; }
  }
  
  let baseColor1 = vec3f(0.1, 0.8, 0.9);
  let baseColor2 = vec3f(0.8, 0.2, 0.9);
  let baseColor3 = vec3f(0.1, 0.9, 0.4);
  
  let colorMix = mix(baseColor1, baseColor2, sin(u.time*0.3)*0.5+0.5);
  let finalColor = mix(colorMix, baseColor3, cos(u.time*0.5)*0.5+0.5);

  col += finalColor * glow * 0.2;
  
  if(d < 0.01) {
    let pos = ro + rd * t;
    let e = vec2f(0.01, 0.0);
    let n = normalize(vec3f(
      map(pos + e.xyy) - map(pos - e.xyy),
      map(pos + e.yxy) - map(pos - e.yxy),
      map(pos + e.yyx) - map(pos - e.yyx)
    ));
    
    let light = normalize(vec3f(1.0, 1.0, -1.0));
    let diff = max(dot(n, light), 0.0);
    let fresnel = pow(1.0 - max(dot(n, -rd), 0.0), 3.0);
    
    col += finalColor * diff * 0.6 + fresnel * vec3f(1.0, 0.9, 0.9) * 0.5;
  }
  
  col = col * (1.0 - 0.3*length(p));
  
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
          const p = pointerRef.current
          const { width, height } = configureCanvasSize(canvas, context, device, format)

          device.queue.writeBuffer(uniformBuffer, 0, new Float32Array([
            time, width, height,
            p.x, p.y, p.dx, p.dy, p.down ? 1 : 0,
          ]))

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
      cancelled = true
      stop()
      try { context?.unconfigure() } catch (_) {}
    }
  }, [gpuState, pointerRef])

  return (
    <DemoShell
      title="Bioluminescent Orbs"
      hint="Move mouse to control the central merging orb."
      error={error ?? gpuError}
    >
      <canvas ref={canvasRef} width={1920} height={1080} style={{width:'100%',height:'100%',display:'block'}} className="demo-canvas" />
    </DemoShell>
  )
}
