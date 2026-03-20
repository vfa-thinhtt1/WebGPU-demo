import { useEffect, useRef, useState } from "react"
import { useWebGPU } from "./WebGPUContext.jsx"
import { DemoShell, configureCanvasSize, fullscreenPipeline, startLoop, usePointer } from "./webgpuCommon.jsx"

export default function FractalIslandsDemo() {
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
  time:f32,
  w:f32,
  h:f32,
  mx:f32,
  my:f32,
  mdx:f32,
  mdy:f32,
  down:f32
};

@group(0) @binding(0) var<uniform> u: Uniforms;

fn rxyz(p: vec3f, a: vec3f) -> vec3f {
    var q = p;
    let cx = cos(a.x); let sx = sin(a.x);
    q = vec3f(q.x, cx*q.y - sx*q.z, sx*q.y + cx*q.z);
    let cy = cos(a.y); let sy = sin(a.y);
    q = vec3f(cy*q.x + sy*q.z, q.y, -sy*q.x + cy*q.z);
    let cz = cos(a.z); let sz = sin(a.z);
    q = vec3f(cz*q.x - sz*q.y, sz*q.x + cz*q.y, q.z);
    return q;
}

fn map(p: vec3f) -> f32 {
    let rep = 4.0;
    var q = p;
    // Domain repetition
    q.x = (fract(q.x / rep + 0.5) - 0.5) * rep;
    q.z = (fract(q.z / rep + 0.5) - 0.5) * rep;
    
    // Animate
    q.y += sin(u.time + p.x * 0.5) * 0.5;
    
    q = rxyz(q, vec3f(u.time * 0.2, u.time * 0.3, 0.0));
    var s = 1.0;
    
    for (var i = 0; i < 4; i++) {
        q = abs(q) - vec3f(0.5);
        q = rxyz(q, vec3f(0.1, 0.2, 0.3));
        let scale = 1.8;
        q *= scale;
        s *= scale;
    }
    
    // Sphere
    let d1 = (length(q) - 1.2) / s;
    return d1;
}

@fragment
fn fsMain(@location(0) uv: vec2f) -> @location(0) vec4f {
  let aspect = u.w / u.h;
  var p = (uv - 0.5) * vec2f(aspect,1.0);
  let mouse = (vec2f(u.mx,u.my)-0.5) * vec2f(aspect,1.0);
  p += mouse * 0.5;

  let ro = vec3f(u.time, 2.0, u.time);
  let rd = normalize(vec3f(p.x, p.y - 0.2, 1.0));
  
  var t = 0.0;
  var iters = 0;
  var hit = false;
  for (; iters < 80; iters++) {
      let d = map(ro + rd*t);
      if (d < 0.005) { hit = true; break; }
      if (t > 20.0) { break; }
      t += d * 0.7; // Under-relax for fractals
  }
  
  var col = vec3f(0.0);
  if (hit) {
      let pos = ro + rd*t;
      let e = vec2f(0.005, 0.0);
      let n = normalize(vec3f(
          map(pos + e.xyy) - map(pos - e.xyy),
          map(pos + e.yxy) - map(pos - e.yxy),
          map(pos + e.yyx) - map(pos - e.yyx)
      ));
      
      let light = normalize(vec3f(1.0, 1.0, -0.5));
      let diff = max(dot(n, light), 0.0);
      let amb = 0.2 + 0.8 * max(n.y, 0.0);
      
      col = vec3f(0.7, 0.4, 0.8) * diff + vec3f(0.1, 0.2, 0.3) * amb;
      
      // glow
      col += vec3f(0.5, 0.8, 1.0) * f32(iters) / 80.0 * 2.0;
  } else {
      let skyGradient = clamp(rd.y, 0.0, 1.0);
      col = mix(vec3f(0.9, 0.7, 0.5), vec3f(0.2, 0.3, 0.6), skyGradient);
  }
  
  let fog = exp(-t*0.1);
  let bg = mix(vec3f(0.9, 0.7, 0.5), vec3f(0.2, 0.3, 0.6), clamp(rd.y, 0.0, 1.0));
  col = mix(bg, col, fog);
  
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
            p.x, 1 - p.y, p.dx, -p.dy, p.down ? 1 : 0,
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
      title="Fractal Islands"
      hint="Watch the surreal landscape drift infinitely."
      error={error ?? gpuError}
    >
      <canvas ref={canvasRef} width={1920} height={1080} style={{width:'100%',height:'100%',display:'block'}} className="demo-canvas" />
    </DemoShell>
  )
}
