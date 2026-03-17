import { useEffect, useRef, useState } from "react"
import { useWebGPU } from "./WebGPUContext.jsx"
import {
  DemoShell,
  configureCanvasSize,
  fullscreenPipeline,
  startLoop,
  usePointer,
} from "./webgpuCommon.jsx"

export default function LiquidChromeDemo() {
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

// ── SDF Primitives ──────────────────────────────────────────────────────────

fn sdSphere(p: vec3f, s: f32) -> f32 {
    return length(p) - s;
}

fn sdTorus(p: vec3f, t: vec2f) -> f32 {
    let q = vec2f(length(p.xz) - t.x, p.y);
    return length(q) - t.y;
}

fn smin(a: f32, b: f32, k: f32) -> f32 {
    let h = max(k - abs(a - b), 0.0) / k;
    return min(a, b) - h * h * h * k * (1.0 / 6.0);
}

// ── Scene ────────────────────────────────────────────────────────────────────

fn map(p_in: vec3f) -> f32 {
    let t = u.time * 0.4;
    var p = p_in;
    
    // Global distortion
    p += sin(p.yzx * 2.0 + t) * 0.15;
    
    // Central "mercury" blobs
    let b1 = sdSphere(p - vec3f(sin(t*1.2)*0.8, cos(t*0.9)*0.5, sin(t*0.5)*0.3), 0.45);
    let b2 = sdSphere(p - vec3f(cos(t*1.1)*0.7, sin(t*1.3)*0.6, cos(t*0.7)*0.4), 0.4);
    let t1 = sdTorus(p, vec2f(0.8 + 0.2 * sin(t), 0.15));
    
    // Combine with smooth minimum for liquid feel
    var d = smin(b1, b2, 0.4);
    d = smin(d, t1, 0.5);
    
    // Interaction: Mouse pushes the liquid or creates a ripple
    let mouse = (vec2f(u.mx, u.my) - 0.5) * 2.5;
    let dMouse = sdSphere(p - vec3f(mouse.x, -mouse.y, 0.0), 0.3);
    d = smin(d, dMouse, 0.3 * u.down + 0.1);
    
    return d;
}

fn getNormal(p: vec3f) -> vec3f {
    let e = vec2f(0.001, 0.0);
    return normalize(vec3f(
        map(p + e.xyy) - map(p - e.xyy),
        map(p + e.yxy) - map(p - e.yxy),
        map(p + e.yyx) - map(p - e.yyx)
    ));
}

// ── Rendering ────────────────────────────────────────────────────────────────

fn getEnv(rd: vec3f) -> vec3f {
    // Procedural studio environment
    // Dark walls with bright rectangular highlights for sharp reflections
    let sky = mix(vec3f(0.02), vec3f(0.05, 0.07, 0.1), rd.y * 0.5 + 0.5);
    
    // Sharp lights
    var light = 0.0;
    // Top light
    light += smoothstep(0.8, 0.95, rd.y) * 2.0;
    // Side light 1
    light += smoothstep(0.9, 0.98, dot(rd, normalize(vec3f(1.0, 0.0, 0.5)))) * 1.5;
    // Side light 2
    light += smoothstep(0.95, 0.99, dot(rd, normalize(vec3f(-0.8, 0.2, -0.6)))) * 3.0;
    
    return sky + vec3f(light);
}

@fragment
fn fsMain(@location(0) uv: vec2f) -> @location(0) vec4f {
    let aspect = u.w / u.h;
    let p = (uv - 0.5) * vec2f(aspect, 1.0);
    
    let ro = vec3f(0.0, 0.0, 2.5);
    let rd = normalize(vec3f(p, -1.0));
    
    var t = 0.0;
    var hit = false;
    for (var i = 0; i < 70; i++) {
        let d = map(ro + rd * t);
        if (d < 0.001) {
            hit = true;
            break;
        }
        t += d;
        if (t > 10.0) { break; }
    }
    
    var col = vec3f(0.0);
    if (hit) {
        let pos = ro + rd * t;
        let n = getNormal(pos);
        let reflectRd = reflect(rd, n);
        
        // Environment mapping for chrome
        let reflection = getEnv(reflectRd);
        
        // Fresnel for depth
        let fresnel = pow(1.0 + dot(rd, n), 3.0);
        
        // Base chrome look
        col = reflection;
        
        // Subtle color tint or "anisotropy" effect
        let tint = 0.5 + 0.5 * cos(u.time * 0.2 + pos.y * 2.0 + vec3f(0.0, 0.6, 1.2));
        col = mix(col, col * tint, 0.1);
        
        // Add a bit of dark occlusion
        col *= 0.5 + 0.5 * n.y;
        
        // Brighten freshen edges
        col += vec3f(0.5, 0.8, 1.0) * fresnel * 0.5;
    } else {
        // Floor shadow / ambient occlusion approximation
        let bg = getEnv(rd);
        col = bg * 0.2;
    }
    
    // Post process
    col = col / (col + vec3f(1.0));
    col = pow(max(col, vec3f(0.0)), vec3f(1.0 / 2.2));

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
              0, 0, 0, 0
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
      title="Liquid Chrome Sculptures"
      hint="Watch the metallic surface flow. Moving the mouse pushes the liquid metal away."
      error={error ?? gpuError}
    >
      <canvas ref={canvasRef} width={1920} height={1080} style={{ width: '100%', height: '100%', display: 'block' }} className="demo-canvas" />
    </DemoShell>
  )
}
