import { useEffect, useRef, useState } from "react"
import { useWebGPU } from "./WebGPUContext.jsx"
import {
  DemoShell,
  configureCanvasSize,
  fullscreenPipeline,
  startLoop,
  usePointer,
} from "./webgpuCommon.jsx"

export default function NeonGridDemo() {
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
            size: 4 * 16, // time, w, h, mx, my, mdx, mdy, down + padding
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

// ── Noise / Terrain ───────────────────────────────────────────────────────────

fn hash(p: vec2f) -> f32 {
    let q = fract(p * vec2f(0.1031, 0.1030));
    let q2 = q + dot(q, q.yx + 33.33);
    return fract((q2.x + q2.y) * q2.x);
}

fn noise(p: vec2f) -> f32 {
    let i = floor(p);
    let f = fract(p);
    let u2 = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i + vec2f(0,0)), hash(i + vec2f(1,0)), u2.x),
               mix(hash(i + vec2f(0,1)), hash(i + vec2f(1,1)), u2.x), u2.y);
}

fn terrain(p: vec2f) -> f32 {
    var v = 0.0;
    var a = 0.5;
    var pos = p * 0.4;
    for(var i=0; i<4; i++) {
        v += a * noise(pos);
        pos *= 2.5;
        a *= 0.45;
    }
    // Deep valley in center
    let center = abs(p.x) * 0.5;
    return v * 2.5 * smoothstep(0.0, 1.5, center);
}

// ── Raymarching ───────────────────────────────────────────────────────────────

@fragment
fn fsMain(@location(0) uv: vec2f) -> @location(0) vec4f {
    let aspect = u.w / u.h;
    let p = (uv - 0.5) * vec2f(aspect, 1.0);
    
    // Camera
    let mouse = (vec2f(u.mx, u.my) - 0.5) * 2.0;
    let forwardSpeed = 3.0;
    let ro = vec3f(mouse.x * 2.0, 1.2 + mouse.y * 0.5, u.time * forwardSpeed);
    let lookAt = ro + vec3f(0.0, -0.3, 5.0);
    
    let fwd = normalize(lookAt - ro);
    let right = normalize(cross(vec3f(0,1,0), fwd));
    let up = cross(fwd, right);
    let rd = normalize(fwd + p.x * right + p.y * up);

    // Marching
    var t = 0.1;
    var hit = false;
    var pos = ro;
    
    for(var i=0; i<80; i++) {
        pos = ro + rd * t;
        let h = terrain(pos.xz);
        if(pos.y < h) {
            hit = true;
            break;
        }
        t += (pos.y - h) * 0.6;
        if(t > 30.0) { break; }
    }

    // Coloring
    var col = vec3f(0.0);
    let sky = mix(vec3f(0.02, 0.0, 0.05), vec3f(0.2, 0.0, 0.4), exp(-abs(p.y)*4.0));
    
    if(hit) {
        let eps = 0.02;
        let nor = normalize(vec3f(
            terrain(pos.xz - vec2f(eps, 0)) - terrain(pos.xz + vec2f(eps, 0)),
            eps * 2.0,
            terrain(pos.xz - vec2f(0, eps)) - terrain(pos.xz + vec2f(0, eps))
        ));

        // Grid lines
        let gridScale = 1.0;
        let gx = abs(fract(pos.x * gridScale + 0.5) - 0.5) / gridScale;
        let gz = abs(fract(pos.z * gridScale + 0.5) - 0.5) / gridScale;
        let line = smoothstep(0.06, 0.0, min(gx, gz));
        
        let neon = vec3f(0.0, 0.8, 1.0) * line * 2.0 * exp(-t * 0.15);
        let base = vec3f(0.02, 0.01, 0.05) * (1.0 - line);
        
        col = base + neon;
        
        // Fog
        col = mix(col, sky, smoothstep(10.0, 25.0, t));
    } else {
        col = sky;
        // Sun / Glow
        let sunDir = normalize(vec3f(0, 0.1, 1));
        let sun = pow(max(dot(rd, sunDir), 0.0), 32.0);
        col += vec3f(1.0, 0.4, 0.1) * sun * 0.5;
    }

    // Post processing
    col = pow(col, vec3f(0.4545)); // Gamma
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
              ptr.x, 1 - ptr.y, ptr.dx, -ptr.dy, ptr.down ? 1 : 0,
              0, 0, 0, 0, 0, 0, 0, 0 // Padding
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
      title="Neon Grid"
      hint="Raymarched 3D landscape. Move mouse to tilt camera."
      error={error ?? gpuError}
    >
      <canvas ref={canvasRef} width={1920} height={1080} style={{ width: '100%', height: '100%', display: 'block' }} className="demo-canvas" />
    </DemoShell>
  )
}
