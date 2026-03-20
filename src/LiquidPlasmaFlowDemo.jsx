import { useEffect, useRef, useState } from "react"
import { useWebGPU } from "./WebGPUContext.jsx"
import { DemoShell, configureCanvasSize, fullscreenPipeline, startLoop, usePointer } from "./webgpuCommon.jsx"

export default function LiquidPlasmaFlowDemo() {
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

fn hash22(p_in: vec2f) -> vec2f {
    var p = vec2f(dot(p_in, vec2f(127.1, 311.7)), dot(p_in, vec2f(269.5, 183.3)));
    return fract(sin(p) * 43758.5453) * 2.0 - 1.0;
}

fn noise(p: vec2f) -> f32 {
    let i = floor(p);
    let f = fract(p);
    
    let u_v = f * f * (3.0 - 2.0 * f);
    
    return mix(
        mix(dot(hash22(i + vec2f(0.0, 0.0)), f - vec2f(0.0, 0.0)),
            dot(hash22(i + vec2f(1.0, 0.0)), f - vec2f(1.0, 0.0)), u_v.x),
        mix(dot(hash22(i + vec2f(0.0, 1.0)), f - vec2f(0.0, 1.0)),
            dot(hash22(i + vec2f(1.0, 1.0)), f - vec2f(1.0, 1.0)), u_v.x),
        u_v.y);
}

fn mat2(a: f32) -> mat2x2<f32> {
    let c = cos(a); let s = sin(a);
    return mat2x2<f32>(c, -s, s, c);
}

fn fbm(p: vec2f) -> f32 {
    var f = 0.0;
    var amp = 0.5;
    var pos = p;
    let m = mat2(0.5);
    
    for(var i = 0; i < 5; i++) {
        f += amp * noise(pos);
        pos = m * pos * 2.02;
        amp *= 0.5;
    }
    // Output range around -0.5 to 0.5
    return f;
}

@fragment
fn fsMain(@location(0) uv: vec2f) -> @location(0) vec4f {
    let aspect = u.w / u.h;
    var p = (uv - 0.5) * vec2f(aspect, 1.0);
    p *= 3.0;
    
    let mx = u.mx * 2.0;
    let my = u.my * 2.0;
    
    let t = u.time * 0.4;
    
    // Domain warping
    // q = f(p)
    var q = vec2f(
        fbm(p + vec2f(0.0, 0.0) + t),
        fbm(p + vec2f(5.2, 1.3) - t)
    );
    
    // r = f(p + q)
    var r = vec2f(
        fbm(p + 4.0 * q + vec2f(1.7, 9.2) + 0.5 * t),
        fbm(p + 4.0 * q + vec2f(8.3, 2.8) - 0.5 * t)
    );
    
    // Interactive warping from mouse
    r += vec2f(mx, my) * 0.5;
    
    // Final noise value
    let f = fbm(p + 4.0 * r);
    
    // Map f to a liquid-like color palette
    var col = mix(vec3f(0.1, 0.1, 0.4), vec3f(0.2, 0.5, 0.8), clamp((f + 0.5) * 2.0, 0.0, 1.0));
    col = mix(col, vec3f(0.8, 0.1, 0.6), clamp(length(q), 0.0, 1.0));
    col = mix(col, vec3f(0.1, 0.9, 0.9), clamp(length(r.x), 0.0, 1.0));
    
    // Highlight edges from the derivative of f
    let d = clamp(pow(f * 2.5, 2.0), 0.0, 1.0);
    col += vec3f(1.0, 0.9, 0.8) * d * 0.8;
    
    // Add glowing specs
    col += vec3f(1.0) * pow(abs(f), 8.0) * 10.0;
    
    // Tone mapping
    col = col / (1.0 + col);
    col = pow(col, vec3f(1.0 / 2.2));
    
    // Soft vignette
    let uv2 = uv - 0.5;
    col *= 1.0 - 0.5 * dot(uv2, uv2);

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
            ptr.x, ptr.y, ptr.dx, ptr.dy, ptr.down ? 1 : 0,
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
      title="Liquid Plasma Flow"
      hint="Swirling digital liquid using highly warped fractal 2D noise."
      error={error ?? gpuError}
    >
      <canvas ref={canvasRef} width={1920} height={1080} style={{width:'100%',height:'100%',display:'block'}} className="demo-canvas" />
    </DemoShell>
  )
}
