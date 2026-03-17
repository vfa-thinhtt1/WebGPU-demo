import { useEffect, useRef, useState } from "react"
import { useWebGPU } from "./WebGPUContext.jsx"
import {
  DemoShell,
  configureCanvasSize,
  fullscreenPipeline,
  startLoop,
  usePointer,
} from "./webgpuCommon.jsx"

export default function AuroraDemo() {
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

// ── Hash / noise ─────────────────────────────────────────────────────────────

fn h21(p: vec2f) -> f32 {
  var q = fract(p * vec2f(127.1, 311.7));
  q += dot(q, q + 19.19);
  return fract(q.x * q.y);
}

fn h11(x: f32) -> f32 { return fract(sin(x * 127.1) * 43758.5453); }

fn smoothnoise(x: f32) -> f32 {
  let i = floor(x);
  let f = fract(x);
  let u2 = f * f * (3.0 - 2.0 * f);
  return mix(h11(i), h11(i + 1.0), u2);
}

fn vnoise2(p: vec2f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u2 = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(h21(i + vec2f(0,0)), h21(i + vec2f(1,0)), u2.x),
    mix(h21(i + vec2f(0,1)), h21(i + vec2f(1,1)), u2.x),
    u2.y
  );
}

fn fbm(p_in: vec2f, oct: i32) -> f32 {
  var v  = 0.0;
  var a  = 0.5;
  var pp = p_in;
  for (var i = 0; i < oct; i++) {
    v  += a * vnoise2(pp);
    pp *= 2.07;
    a  *= 0.5;
  }
  return v;
}

// ── Star field ───────────────────────────────────────────────────────────────

fn stars(uv: vec2f, scale: f32, t: f32) -> f32 {
  let p   = uv * scale;
  let ip  = floor(p);
  let fp  = fract(p);
  let rnd = h21(ip);
  let pos = vec2f(h21(ip + 1.1), h21(ip + 2.3)) * 0.7 + 0.15;
  let twinkle = 0.6 + 0.4 * sin(t * (2.0 + rnd * 4.0) + rnd * 6.28);
  let d = length(fp - pos);
  return twinkle / (1.0 + d * d * scale * scale * 0.6);
}

// ── Single aurora curtain ─────────────────────────────────────────────────────
// Returns (brightness, hue-shift)
fn curtain(uv: vec2f, t: f32, seed: f32, speed: f32, yOff: f32, mouseRipple: f32) -> vec2f {
  let aspect = u.w / u.h;

  // horizontal flow: each vertical strip wiggles independently
  let xFreq  = 2.8 + seed * 1.2;
  let wave   = fbm(vec2f(uv.x * xFreq + seed * 7.3 + t * speed, t * 0.15 + seed), 4);
  let curveY = yOff + (wave - 0.5) * 0.18 + mouseRipple * 0.12;

  // curtain hangs downward from curveY with soft vertical falloff
  let dist   = uv.y - curveY;
  let above  = smoothstep(0.0, 0.08, -dist);           // fade at top edge
  let below  = smoothstep(0.0, 0.38, dist + 0.38);    // fade toward bottom

  // brightness shimmer along the curtain
  let shimmer = fbm(vec2f(uv.x * 5.0 + seed * 3.1, t * 0.4 + seed * 9.7), 3);
  let bright  = above * below * (0.5 + shimmer * 0.8);

  // colour variation per curtain (0=green, 0.5=cyan, 1=magenta)
  let hue = fract(seed * 0.618 + t * 0.02 + shimmer * 0.3);

  return vec2f(bright, hue);
}

// ── Aurora colour ─────────────────────────────────────────────────────────────
fn auroraColor(bright: f32, hue: f32) -> vec3f {
  // classic aurora palette: deep green / teal / violet / occasional red band
  let green   = vec3f(0.05, 1.0,  0.35);
  let teal    = vec3f(0.0,  0.85, 0.9);
  let violet  = vec3f(0.55, 0.1,  1.0);
  let pink    = vec3f(1.0,  0.15, 0.55);

  var col: vec3f;
  if (hue < 0.33) {
    col = mix(green,  teal,   hue / 0.33);
  } else if (hue < 0.66) {
    col = mix(teal,   violet, (hue - 0.33) / 0.33);
  } else {
    col = mix(violet, pink,   (hue - 0.66) / 0.34);
  }
  return col * bright;
}

// ── Sky gradient ──────────────────────────────────────────────────────────────
fn skyColor(uv: vec2f) -> vec3f {
  // deep midnight blue at top → near-black at horizon
  let top    = vec3f(0.01, 0.02, 0.10);
  let horiz  = vec3f(0.04, 0.06, 0.12);
  return mix(horiz, top, uv.y);
}

// ── Main ─────────────────────────────────────────────────────────────────────
@fragment
fn fsMain(@location(0) uv: vec2f) -> @location(0) vec4f {
  let t = u.time;

  // mouse-driven ripple that perturbs the curtains (correct Y: u.my matches uv.y)
  let mouse   = vec2f(u.mx, u.my);
  let mDist   = length(uv - mouse);
  let ripple  = exp(-mDist * mDist * 14.0) * (0.5 + 0.5 * sin(t * 6.0 - mDist * 20.0));
  let mouseRipple = ripple * (u.down * 0.6 + 0.2);

  // ── sky ──
  var col = skyColor(uv);

  // ── stars ──
  var starB = 0.0;
  starB += stars(uv, 80.0,  t) * 0.9;
  starB += stars(uv, 145.0, t) * 0.5;
  starB += stars(uv, 260.0, t) * 0.25;
  // stars only visible in the upper sky
  let skyMask = smoothstep(0.25, 0.55, uv.y);
  col += vec3f(starB) * skyMask * 0.55;

  // ── aurora curtains (layered) ──
  // curtains live in the upper half of the screen
  let NUM_CURTAINS = 5;
  for (var i = 0; i < NUM_CURTAINS; i++) {
    let seed  = f32(i) * 1.618;
    let speed = 0.08 + f32(i) * 0.03;
    let yOff  = 0.52 + f32(i) * 0.06;    // stagger vertical positions
    let ch    = curtain(uv, t, seed, speed, yOff, mouseRipple);
    let ac    = auroraColor(ch.x, ch.y);
    // additive blending — layers accumulate
    col      += ac * (0.55 + f32(i) * 0.08);
  }

  // ── subtle ground glow at horizon ──
  let groundGlow = smoothstep(0.18, 0.0, uv.y) * 0.08;
  col += vec3f(0.0, 0.4, 0.2) * groundGlow;

  // ── lens-flare-like glow on mouse hover ──
  let hoverGlow = exp(-mDist * mDist * 40.0) * 0.35;
  col += vec3f(0.3, 0.8, 0.6) * hoverGlow;

  // ── tone-map & gamma ──
  col = col / (col + vec3f(1.0)) * 1.35;
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
      title="Aurora Borealis"
      hint="Move mouse to ripple the aurora. Click to intensify the effect."
      error={error ?? gpuError}
    >
      <canvas ref={canvasRef} width={1920} height={1080} style={{ width: '100%', height: '100%', display: 'block' }} className="demo-canvas" />
    </DemoShell>
  )
}
