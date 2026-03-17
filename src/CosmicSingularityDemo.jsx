import { useEffect, useRef, useState } from "react"
import { useWebGPU } from "./WebGPUContext.jsx"
import {
  DemoShell,
  configureCanvasSize,
  fullscreenPipeline,
  startLoop,
  usePointer,
} from "./webgpuCommon.jsx"

export default function CosmicSingularityDemo() {
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
            size: 4 * 8, // 8 floats
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

// ── Helpers ──────────────────────────────────────────────────────────────────

fn h21(p: vec2f) -> f32 {
  var q = fract(p * vec2f(127.1, 311.7));
  q += dot(q, q + 19.19);
  return fract(q.x * q.y);
}

fn rot(a: f32) -> mat2x2f {
  let s = sin(a);
  let c = cos(a);
  return mat2x2f(c, -s, s, c);
}

// ── Stars ────────────────────────────────────────────────────────────────────

fn starfield(uv: vec2f, t: f32) -> f32 {
  var col = 0.0;
  for (var i = 0.0; i < 3.0; i += 1.0) {
    let scale = pow(2.0, i + 2.0);
    let p = uv * scale * 10.0;
    let id = floor(p);
    let f = fract(p);
    let rnd = h21(id);
    if (rnd > 0.95) {
      let size = rnd * 0.15;
      let dist = length(f - 0.5);
      let twinkle = 0.5 + 0.5 * sin(t * (2.0 + rnd * 10.0) + rnd * 6.28);
      col += smoothstep(size, 0.0, dist) * twinkle;
    }
  }
  return col;
}

// ── Accretion Disk ───────────────────────────────────────────────────────────

fn noise(p: vec2f) -> f32 {
    let i = floor(p);
    let f = fract(p);
    let u2 = f * f * (3.0 - 2.0 * f);
    return mix(
        mix(h21(i + vec2f(0,0)), h21(i + vec2f(1,0)), u2.x),
        mix(h21(i + vec2f(0,1)), h21(i + vec2f(1,1)), u2.x),
        u2.y
    );
}

fn fbm(p: vec2f) -> f32 {
    var v = 0.0;
    var a = 0.5;
    var pp = p;
    for (var i = 0; i < 4; i++) {
        v += a * noise(pp);
        pp *= 2.0;
        a *= 0.5;
    }
    return v;
}

// ── Main ─────────────────────────────────────────────────────────────────────

@fragment
fn fsMain(@location(0) uv: vec2f) -> @location(0) vec4f {
  let aspect = u.w / u.h;
  var p = (uv - 0.5) * vec2f(aspect, 1.0);
  let mouse = (vec2f(u.mx, u.my) - 0.5) * vec2f(aspect, 1.0);
  
  // Gravitational Lensing effect
  // Light is bent towards the singularity
  let dist = length(p);
  let bhRadius = 0.2;
  let lensingStrength = 0.1;
  
  // Distortion lookup for background
  var backgroundP = p;
  if (dist > bhRadius * 0.5) {
      let distortion = lensingStrength / (dist + 0.01);
      backgroundP -= normalize(p) * distortion * 0.5;
  }

  // Draw Starfield Background
  var col = vec3f(starfield(backgroundP, u.time) * 0.4);
  
  // Deep space glow
  col += vec3f(0.02, 0.01, 0.05) * (1.0 - dist * 0.5);

  // Accretion Disk Simulation
  // We simulate a rotating disk using polar coordinates
  let angle = atan2(p.y, p.x);
  let r = length(p);
  
  // Distort disk coordinates
  let diskDistortion = fbm(p * 5.0 + u.time * 0.2) * 0.05;
  let distortedR = r + diskDistortion;
  
  // Disk ranges
  let innerDisk = bhRadius * 1.2;
  let outerDisk = bhRadius * 4.0;
  
  if (distortedR > innerDisk && distortedR < outerDisk) {
      let diskPos = (distortedR - innerDisk) / (outerDisk - innerDisk);
      
      // Rotating flow
      let flow = fbm(vec2f(angle * 3.0 + u.time * 1.5, distortedR * 8.0 - u.time * 0.5));
      
      // Color palette: Orange / White hot
      let orange = vec3f(1.0, 0.4, 0.1);
      let white = vec3f(1.0, 1.0, 0.9);
      let diskCol = mix(orange, white, pow(flow, 2.0));
      
      // Fade edges
      let diskAlpha = smoothstep(0.0, 0.2, diskPos) * smoothstep(1.0, 0.7, diskPos);
      let diskIntensity = pow(flow, 1.5) * diskAlpha * 2.5;
      
      col += diskCol * diskIntensity;
  }
  
  // Event Horizon (The Black Hole)
  let ehMask = smoothstep(bhRadius, bhRadius - 0.005, dist);
  col = mix(col, vec3f(0.0), ehMask);
  
  // Photon Sphere Glow (Thin ring just outside EH)
  let photonRing = smoothstep(bhRadius + 0.01, bhRadius, dist) * smoothstep(bhRadius - 0.02, bhRadius, dist);
  col += vec3f(1.0, 0.8, 0.5) * photonRing * 0.8;

  // Interaction: Mouse light
  let mDist = length(p - mouse);
  let mouseGlow = exp(-mDist * mDist * 10.0) * 0.3;
  col += vec3f(0.5, 0.7, 1.0) * mouseGlow;

  // Final tone-map & gamma
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
      title="Cosmic Singularity"
      hint="Behold the event horizon. Moving the mouse influences the gravitational field."
      error={error ?? gpuError}
    >
      <canvas ref={canvasRef} width={1920} height={1080} style={{ width: '100%', height: '100%', display: 'block' }} className="demo-canvas" />
    </DemoShell>
  )
}
