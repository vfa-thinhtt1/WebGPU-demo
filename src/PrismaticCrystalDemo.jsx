import { useEffect, useRef, useState } from "react"
import { useWebGPU } from "./WebGPUContext.jsx"
import {
  DemoShell,
  configureCanvasSize,
  fullscreenPipeline,
  startLoop,
  usePointer,
} from "./webgpuCommon.jsx"

export default function PrismaticCrystalDemo() {
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
            size: 4 * 12, // 12 floats (time, w, h, mx, my, mdx, mdy, down, pad1, pad2, pad3, pad4)
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

// ── Raymarching & SDF ─────────────────────────────────────────────────────────

fn sdOctahedron(p_in: vec3f, s: f32) -> f32 {
  let p = abs(p_in);
  let m = p.x + p.y + p.z - s;
  var q: vec3f;
  if (3.0 * p.x < m) { q = p.xyz; }
  else if (3.0 * p.y < m) { q = p.yzx; }
  else if (3.0 * p.z < m) { q = p.zxy; }
  else { return m * 0.57735027; }
    
  let k = clamp(0.5 * (q.z - q.y + s), 0.0, s); 
  return length(vec3f(q.x, q.y - s + k, q.z - k)); 
}

fn rotateY(a: f32) -> mat3x3f {
    let s = sin(a);
    let c = cos(a);
    return mat3x3f(
        vec3f(c, 0.0, s),
        vec3f(0.0, 1.0, 0.0),
        vec3f(-s, 0.0, c)
    );
}

fn rotateX(a: f32) -> mat3x3f {
    let s = sin(a);
    let c = cos(a);
    return mat3x3f(
        vec3f(1.0, 0.0, 0.0),
        vec3f(0.0, c, -s),
        vec3f(0.0, s, c)
    );
}

fn map(p: vec3f) -> f32 {
    let rot = rotateY(u.time * 0.5 + u.mx * 2.0) * rotateX(u.time * 0.3 + u.my * 2.0);
    let q = rot * p;
    
    // Main crystal
    var d = sdOctahedron(q, 1.0);
    
    // Iterative detail / fracturing
    var scale = 1.0;
    for (var i = 0; i < 3; i++) {
        let offset = 0.5 / scale;
        let q2 = abs(q) - offset;
        let d2 = sdOctahedron(q2, 0.4 / scale);
        d = max(d, -d2); // Subtract some inner parts
        scale *= 1.8;
    }
    
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

// ── Background & Starfield ───────────────────────────────────────────────────

fn h21(p: vec2f) -> f32 {
  var q = fract(p * vec2f(127.1, 311.7));
  q += dot(q, q + 19.19);
  return fract(q.x * q.y);
}

fn background(rd: vec3f) -> vec3f {
    let uv = rd.xy;
    var col = mix(vec3f(0.02, 0.02, 0.05), vec3f(0.05, 0.08, 0.15), rd.y * 0.5 + 0.5);
    
    // Subtle stars
    let p = uv * 20.0;
    let id = floor(p);
    let rnd = h21(id);
    if (rnd > 0.98) {
        let twinkle = 0.5 + 0.5 * sin(u.time + rnd * 10.0);
        col += vec3f(0.8, 0.9, 1.0) * twinkle * smoothstep(0.1, 0.0, length(fract(p) - 0.5));
    }
    
    return col;
}

// ── Main ─────────────────────────────────────────────────────────────────────

@fragment
fn fsMain(@location(0) uv: vec2f) -> @location(0) vec4f {
  let aspect = u.w / u.h;
  let p = (uv - 0.5) * vec2f(aspect, 1.0);
  
  // Camera Setup
  let ro = vec3f(0.0, 0.0, -3.5);
  let rd = normalize(vec3f(p, 1.5));
  
  // Raymarching
  var t = 0.0;
  var d = 0.0;
  var pos = ro;
  var hit = false;
  
  for (var i = 0; i < 80; i++) {
      pos = ro + rd * t;
      d = map(pos);
      if (d < 0.001) {
          hit = true;
          break;
      }
      t += d;
      if (t > 10.0) { break; }
  }
  
  var col = vec3f(0.0);
  
  if (hit) {
      let n = getNormal(pos);
      let lightDir = normalize(vec3f(1.0, 2.0, -2.0));
      
      // Basic Lighting
      let diff = max(dot(n, lightDir), 0.0);
      let viewDir = -rd;
      let reflectDir = reflect(-lightDir, n);
      let spec = pow(max(dot(viewDir, reflectDir), 0.0), 32.0);
      
      // Iridescence effect
      let fresnel = pow(clamp(1.0 - dot(n, viewDir), 0.0, 1.0), 3.0);
      let hue = fract(dot(n, vec3f(1.0)) * 0.5 + u.time * 0.1);
      let iridCol = mix(vec3f(0.5, 0.8, 1.0), vec3f(1.0, 0.5, 0.8), sin(hue * 6.28) * 0.5 + 0.5);
      
      // Combine lighting
      col = mix(vec3f(0.1, 0.2, 0.3) * diff, iridCol, fresnel);
      col += spec * iridCol * 0.8;
      
      // Internal Glow / Refraction approximation
      let refractRd = refract(rd, n, 0.7);
      let bgTarget = background(refractRd);
      col = mix(col, bgTarget, 0.3);
      
      // Glow based on proximity to center
      col += vec3f(0.2, 0.4, 0.8) * (1.0 - length(pos) * 0.5) * (u.down * 0.5 + 0.2);
      
  } else {
      col = background(rd);
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

            // Padding to align to 16-byte boundaries (std140 style)
            device.queue.writeBuffer(uniformBuffer, 0, new Float32Array([
              time, width, height,
              ptr.x, 1 - ptr.y, ptr.dx, -ptr.dy, ptr.down ? 1 : 0,
              0, 0, 0, 0 // Padding
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
      title="Prismatic Crystal"
      hint="Drag to rotate the crystal. Hold click to intensify the internal glow."
      error={error ?? gpuError}
    >
      <canvas ref={canvasRef} width={1920} height={1080} style={{ width: '100%', height: '100%', display: 'block' }} className="demo-canvas" />
    </DemoShell>
  )
}
