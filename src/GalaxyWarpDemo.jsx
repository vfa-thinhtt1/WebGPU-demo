import { useEffect, useRef, useState } from "react"
import { useWebGPU } from "./WebGPUContext.jsx"
import {
  DemoShell,
  configureCanvasSize,
  fullscreenPipeline,
  startLoop,
  usePointer,
} from "./webgpuCommon.jsx"

export default function GalaxyWarpDemo() {
  const canvasRef   = useRef(null)
  const pointerRef  = usePointer(canvasRef)
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
        // Each demo configures the canvas context on the shared device
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

fn hash21(p: vec2f) -> f32 {
  var q = fract(p * vec2f(127.1, 311.7));
  q += dot(q, q + 19.19);
  return fract(q.x * q.y);
}

fn noise(p: vec2f) -> f32 {
  let i  = floor(p);
  let f  = fract(p);
  let u2 = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash21(i + vec2f(0,0)), hash21(i + vec2f(1,0)), u2.x),
    mix(hash21(i + vec2f(0,1)), hash21(i + vec2f(1,1)), u2.x),
    u2.y
  );
}

fn fbm(p_in: vec2f) -> f32 {
  var v  = 0.0;
  var a  = 0.5;
  var pp = p_in;
  for (var i = 0; i < 5; i++) {
    v  += a * noise(pp);
    pp *= 2.1;
    a  *= 0.5;
  }
  return v;
}

fn palette(t: f32, a: vec3f, b: vec3f, c: vec3f, d: vec3f) -> vec3f {
  return a + b * cos(6.28318 * (c * t + d));
}

fn starLayer(uv: vec2f, scale: f32, speed: f32, t: f32) -> f32 {
  let p   = uv * scale + t * speed;
  let ip  = floor(p);
  let fp  = fract(p);
  let h   = hash21(ip);
  let pos = vec2f(hash21(ip + 1.1), hash21(ip + 2.2)) * 0.7 + 0.15;
  let twinkle = 0.7 + 0.3 * sin(t * 4.0 + h * 13.7);
  let d   = length(fp - pos) * scale * 0.015;
  return twinkle / (1.0 + d * d * 8000.0);
}

fn wormhole(uv: vec2f, center: vec2f, t: f32) -> vec3f {
  var p = uv - center;
  let r = length(p);
  let a = atan2(p.y, p.x);
  let throat  = 0.06 + 0.01 * sin(t * 1.3);
  let lensR   = 0.38;
  var bent    = p;
  if (r > throat) {
    let strength = lensR * lensR / (r * r);
    bent = p * (1.0 - strength * 0.55);
  }
  let diskR     = throat * 2.8;
  let diskWidth = 0.045;
  let diskDist  = abs(r - diskR);
  let diskMask  = exp(-diskDist * diskDist / (diskWidth * diskWidth)) * smoothstep(throat, diskR * 1.8, r);
  let diskAngle = a + t * 1.1;
  let diskFlow  = 0.5 + 0.5 * sin(diskAngle * 8.0 - r * 30.0 + t * 5.0);
  let diskCol   = palette(diskFlow + r,
                    vec3f(0.5), vec3f(0.5),
                    vec3f(1.0, 0.7, 0.4), vec3f(0.0, 0.15, 0.25))
                * (3.5 + diskFlow * 2.0);
  let jetMask = pow(max(0.0, 1.0 - abs(p.x) * 14.0), 3.0)
              * exp(-r * 6.0)
              * (0.5 + 0.5 * sin(t * 4.0 + r * 40.0));
  let jetCol  = vec3f(0.5, 0.9, 1.0) * jetMask * 6.0;
  let core    = exp(-r * 18.0) * 4.0;
  let coreCol = vec3f(1.0, 0.8, 0.5) * core;
  let horizonFade = smoothstep(throat * 1.05, throat * 1.35, r);
  let inner       = 1.0 - horizonFade;
  let ring    = exp(-pow((r - throat * 1.2) / (throat * 0.12), 2.0));
  let ringCol = vec3f(1.0, 0.7, 0.2) * ring * 4.0;
  let nebula  = fbm(bent * 2.5 + t * 0.03) * 0.8
              + 0.2 * fbm(bent * 6.0 - t * 0.05);
  let nebCol  = palette(nebula + t * 0.04,
                  vec3f(0.05, 0.0, 0.1), vec3f(0.5, 0.3, 0.6),
                  vec3f(1.0, 1.0, 1.0), vec3f(0.0, 0.33, 0.67))
              * (nebula * 1.8 + 0.2);
  var col = nebCol;
  col = col * horizonFade;
  col += ringCol * horizonFade;
  col += diskCol * diskMask;
  col += jetCol;
  col += coreCol * (1.0 - inner);
  col  = mix(col, vec3f(0.0), inner * 0.95);
  return col;
}

@fragment
fn fsMain(@location(0) uv: vec2f) -> @location(0) vec4f {
  let aspect = u.w / u.h;
  let p      = (uv - 0.5) * vec2f(aspect, 1.0);
  let t      = u.time;
  let orbitX = sin(t * 0.31) * 0.05;
  let orbitY = cos(t * 0.19) * 0.03;
  let mouse  = (vec2f(u.mx, u.my) - 0.5) * vec2f(aspect, 1.0);
  let center = mix(vec2f(orbitX, orbitY), mouse, 0.4);

  var starBright = 0.0;
  starBright += starLayer(uv + t * vec2f(0.007, 0.005), 70.0,  0.18, t) * 1.0;
  starBright += starLayer(uv + t * vec2f(0.011, 0.009), 120.0, 0.28, t) * 0.6;
  starBright += starLayer(uv + t * vec2f(0.004, 0.013), 200.0, 0.40, t) * 0.3;
  let starCol = vec3f(starBright);

  let wh  = wormhole(p, center, t);
  var col = starCol + wh;
  let vig = 1.0 - smoothstep(0.5, 1.3, length(p) * 1.3);
  col *= vig;
  col  = col / (col + 1.0) * 1.4;
  col  = pow(max(col, vec3f(0.0)), vec3f(1.0 / 2.2));
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

        // Store the removeEventListener so cleanup can call it
        const prevOnResize = onResize
        const origStop = stop
        stop = () => {
          origStop()
          window.removeEventListener("resize", prevOnResize)
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
      title="Galaxy Warp"
      hint="Move mouse to shift the wormhole. Watch the accretion disk spin and stars bend."
      error={error ?? gpuError}
    >
      <canvas ref={canvasRef} width={1920} height={1080} style={{width:'100%',height:'100%',display:'block'}} className="demo-canvas" />
    </DemoShell>
  )
}
