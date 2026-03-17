import { useEffect, useRef, useState } from "react"
import { useWebGPU } from "./WebGPUContext.jsx"
import {
  DemoShell,
  configureCanvasSize,
  fullscreenPipeline,
  startLoop,
  usePointer,
} from "./webgpuCommon.jsx"

export default function LavaOceanDemo() {
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

// ── Hash & noise helpers ─────────────────────────────────────────────────────

fn hash2(p: vec2f) -> f32 {
  var q = fract(p * vec2f(127.1, 311.7));
  q += dot(q, q + 19.19);
  return fract(q.x * q.y);
}

fn hash3(p: vec3f) -> f32 {
  var q = fract(p * vec3f(127.1, 311.7, 74.7));
  q += dot(q, q.yzx + 19.19);
  return fract((q.x + q.y) * q.z);
}

fn vnoise(p: vec2f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u2 = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash2(i + vec2f(0,0)), hash2(i + vec2f(1,0)), u2.x),
    mix(hash2(i + vec2f(0,1)), hash2(i + vec2f(1,1)), u2.x),
    u2.y
  );
}

fn fbm(p_in: vec2f, oct: i32) -> f32 {
  var v  = 0.0;
  var a  = 0.5;
  var pp = p_in;
  for (var i = 0; i < oct; i++) {
    v  += a * vnoise(pp);
    pp *= 2.07;
    a  *= 0.5;
  }
  return v;
}

// ── Lava colour palette ──────────────────────────────────────────────────────

fn lavaColor(heat: f32) -> vec3f {
  // heat: 0 = cool dark crust, 1 = white-hot core
  let h = clamp(heat, 0.0, 1.0);
  // dark crust → red orange → orange → yellow → white
  let crust  = vec3f(0.05, 0.01, 0.0);
  let red    = vec3f(0.8,  0.05, 0.0);
  let orange = vec3f(1.0,  0.35, 0.0);
  let yellow = vec3f(1.0,  0.92, 0.2);
  let white  = vec3f(1.0,  1.0,  0.95);

  var col: vec3f;
  if (h < 0.25) {
    col = mix(crust, red, h / 0.25);
  } else if (h < 0.55) {
    col = mix(red, orange, (h - 0.25) / 0.30);
  } else if (h < 0.80) {
    col = mix(orange, yellow, (h - 0.55) / 0.25);
  } else {
    col = mix(yellow, white, (h - 0.80) / 0.20);
  }
  return col;
}

// ── Crack / cell network ─────────────────────────────────────────────────────

fn crackDist(uv: vec2f, t: f32) -> f32 {
  // Animated Voronoi crust – returns distance to nearest cell edge (0 = on crack)
  let scale = 5.0;
  let p = uv * scale;
  let ip = floor(p);
  var minD1 = 1e9;
  var minD2 = 1e9;
  for (var dy = -1; dy <= 1; dy++) {
    for (var dx = -1; dx <= 1; dx++) {
      let nb  = ip + vec2f(f32(dx), f32(dy));
      let hv  = vec2f(hash2(nb), hash2(nb + 77.7));
      // cells drift very slowly
      let drift = hv * 2.0 - 1.0;
      let cell = nb + 0.5 + 0.35 * sin(hv * 6.28318 + t * 0.18 + drift * 0.5);
      let d = length(p - cell);
      if (d < minD1) { minD2 = minD1; minD1 = d; }
      else if (d < minD2) { minD2 = d; }
    }
  }
  // edge distance: 0 at the border between cells
  return minD2 - minD1;
}

// ── Mouse splash / ripple ────────────────────────────────────────────────────

fn splashHeat(uv: vec2f, mouse: vec2f, t: f32, down: f32) -> f32 {
  let d = length(uv - mouse);
  // continuous subtle glow around cursor
  let hover = exp(-d * d * 28.0) * 0.35;
  // click burst that expands and fades
  let burst = exp(-d * d * 12.0) * down * (0.5 + 0.5 * sin(t * 8.0)) * 1.2;
  return hover + burst;
}

// ── Main fragment ────────────────────────────────────────────────────────────

@fragment
fn fsMain(@location(0) uv: vec2f) -> @location(0) vec4f {
  let aspect = u.w / u.h;
  let t      = u.time;

  // aspect-corrected UV for Voronoi / FBM (keeps shapes round)
  let uvA = uv * vec2f(aspect, 1.0);

  // ── slow undulating lava surface ──
  let flow1 = fbm(uvA * 2.8 + vec2f(t * 0.07, t * 0.04), 6);
  let flow2 = fbm(uvA * 1.9 - vec2f(t * 0.05, t * 0.09) + flow1 * 0.6, 5);
  let flow3 = fbm(uvA * 4.2 + vec2f(t * 0.12, -t * 0.06) + flow2 * 0.4, 4);
  var baseheat = flow1 * 0.45 + flow2 * 0.35 + flow3 * 0.20;

  // ── glowing crack network ──
  let crack  = crackDist(uvA + vec2f(t * 0.025, t * 0.015), t);
  let crackGlow = exp(-crack * crack * 120.0);   // bright along edges
  let crackHeat = exp(-crack * crack * 600.0);   // very thin bright seam

  // combine: cracks are hotter
  var heat = baseheat + crackGlow * 0.45 + crackHeat * 0.5;

  // ── heat shimmer distortion ──
  let shimmerUV = uvA + vec2f(
    fbm(uvA * 6.0 + vec2f(0.0, t * 0.5), 3) - 0.5,
    fbm(uvA * 6.0 + vec2f(t * 0.5, 0.0), 3) - 0.5
  ) * 0.012;

  // shimmer-displaced second sample
  let flowS = fbm(shimmerUV * 3.0 + vec2f(t * 0.08, t * 0.05), 5);
  heat = heat * 0.75 + flowS * 0.25;

  // ── mouse interaction ──
  let mouse = vec2f(u.mx, u.my) * vec2f(aspect, 1.0);
  heat += splashHeat(uvA, mouse, t, u.down);

  heat = clamp(heat, 0.0, 1.0);

  // ── colour mapping ──
  var col = lavaColor(heat);

  // ── atmospheric glow (emissive hotspots bloom) ──
  let bloom = pow(max(heat - 0.6, 0.0) / 0.4, 2.0);
  col += vec3f(1.0, 0.4, 0.05) * bloom * 0.6;

  // ── subtle vignette ──
  let vUV = uv - 0.5;
  let vig = 1.0 - smoothstep(0.38, 0.82, length(vUV) * 1.25);
  col *= (0.4 + 0.6 * vig);

  // gamma
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
      try { context?.unconfigure() } catch (_) {}
    }
  }, [gpuState, pointerRef])

  return (
    <DemoShell
      title="🌋 Lava Ocean"
      hint="Move mouse to heat the surface. Click to ignite a burst."
      error={error ?? gpuError}
    >
      <canvas ref={canvasRef} width={1920} height={1080} style={{width:'100%',height:'100%',display:'block'}} className="demo-canvas" />
    </DemoShell>
  )
}
