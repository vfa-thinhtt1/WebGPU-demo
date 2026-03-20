import { useEffect, useRef, useState } from "react"
import { useWebGPU } from "./WebGPUContext.jsx"
import { DemoShell, configureCanvasSize, fullscreenPipeline, startLoop, usePointer } from "./webgpuCommon.jsx"

export default function LiquidCrystalBlobsDemo() {
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

fn matRotateX(rad: f32) -> mat3x3<f32> {
    let c = cos(rad); let s = sin(rad);
    return mat3x3<f32>(1.0, 0.0, 0.0, 0.0, c, -s, 0.0, s, c);
}

fn matRotateY(rad: f32) -> mat3x3<f32> {
    let c = cos(rad); let s = sin(rad);
    return mat3x3<f32>(c, 0.0, s, 0.0, 1.0, 0.0, -s, 0.0, c);
}

fn smin(a: f32, b: f32, k: f32) -> f32 {
    let h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
    return mix(b, a, h) - k * h * (1.0 - h);
}

fn map(p: vec3f) -> f32 {
    let t = u.time * 0.8;
    
    // Four orbiting blobs
    let s1 = length(p - vec3f(sin(t)*1.5, cos(t*1.2)*1.2, sin(t*0.5)*1.5)) - 0.7;
    let s2 = length(p - vec3f(cos(t*1.3)*1.6, sin(t*0.8)*1.5, cos(t*1.1)*1.6)) - 0.6;
    let s3 = length(p - vec3f(sin(t*0.7)*1.4, cos(t*1.5)*1.2, sin(t*1.3)*1.4)) - 0.8;
    let s4 = length(p - vec3f(cos(t*0.9)*1.2, sin(t*1.1)*1.8, cos(t*1.6)*1.2)) - 0.5;
    
    var d = smin(s1, s2, 1.0);
    d = smin(d, s3, 1.0);
    d = smin(d, s4, 1.0);
    
    // Add tiny high frequency ripples on the surface
    d -= 0.015 * sin(15.0 * p.x + u.time * 4.0) * sin(15.0 * p.y + u.time * 3.0);
    
    return d;
}

fn calcNormal(p: vec3f) -> vec3f {
    let e = vec2f(0.002, 0.0);
    return normalize(vec3f(
        map(p + e.xyy) - map(p - e.xyy),
        map(p + e.yxy) - map(p - e.yxy),
        map(p + e.yyx) - map(p - e.yyx)
    ));
}

// Procedural volumetric background
fn getBackground(rd: vec3f) -> vec3f {
    // Generate a colorful swirl based on ray direction
    let uv = vec2f(atan2(rd.z, rd.x), asin(rd.y));
    
    let a = uv.x * 3.0 + u.time * 0.5;
    let b = uv.y * 3.0 - u.time * 0.3;
    
    let f = sin(a) * cos(b) + sin(a * 2.0 + b) * 0.5;
    
    let pal_a = vec3f(0.5, 0.5, 0.5);
    let pal_b = vec3f(0.5, 0.5, 0.5);
    let pal_c = vec3f(1.0, 1.0, 1.0);
    let pal_d = vec3f(0.0, 0.33, 0.67);
    
    let col = pal_a + pal_b * cos(6.28318 * (pal_c * (f * 0.5 + 0.5) + pal_d));
    return col * (0.5 + 0.5 * max(0.0, rd.y));
}

fn refract(I: vec3f, N: vec3f, eta: f32) -> vec3f {
    let cosi = dot(-I, N);
    let cost2 = 1.0 - eta * eta * (1.0 - cosi * cosi);
    var t = vec3f(0.0);
    if (cost2 > 0.0) {
        t = eta * I + (eta * cosi - sqrt(abs(cost2))) * N;
    } else {
        // total internal reflection
        t = reflect(I, N);
    }
    return t;
}

@fragment
fn fsMain(@location(0) uv: vec2f) -> @location(0) vec4f {
    let aspect = u.w / u.h;
    var p = (uv - 0.5) * vec2f(aspect, 1.0);
    
    let mx = (u.mx - 0.5) * 6.28;
    let my = -(u.my - 0.5) * 3.14;
    
    var ro = vec3f(0.0, 0.0, 5.0);
    var rd = normalize(vec3f(p, -1.0));
    
    let rotX = matRotateX(my);
    let rotY = matRotateY(mx + u.time * 0.1);
    
    ro = rotY * rotX * ro;
    rd = rotY * rotX * rd;
    
    var t = 0.0;
    var hit = false;
    var pos = ro;
    
    for(var i = 0; i < 90; i++) {
        pos = ro + rd * t;
        let d = map(pos);
        if(d < 0.001) {
            hit = true;
            break;
        }
        t += d;
        if(t > 15.0) { break; }
    }
    
    var col = getBackground(rd);
    
    if (hit) {
        let n = calcNormal(pos);
        
        // Refraction vector (eta = ratio of indices of refraction, e.g. 1.0 / 1.5 for air to glass)
        let refr = refract(rd, n, 0.7);
        let refl = reflect(rd, n);
        
        let fresnel = pow(1.0 - max(dot(n, -rd), 0.0), 4.0);
        
        let bgRefr = getBackground(refr);
        let bgRefl = getBackground(refl);
        
        let sunDir = normalize(vec3f(1.0, 1.0, 1.0));
        let spec = pow(max(dot(refl, sunDir), 0.0), 64.0);
        
        // Combine refraction and reflection
        col = mix(bgRefr, bgRefl, fresnel);
        col += vec3f(1.0) * spec * 0.5;
        
        // Chromatic aberration approximation:
        let refrR = refract(rd, n, 0.72);
        let refrB = refract(rd, n, 0.68);
        col.r = mix(col.r, getBackground(refrR).r, 0.5);
        col.b = mix(col.b, getBackground(refrB).b, 0.5);
    }
    
    // Tone mapping
    col = col / (1.0 + col);
    col = pow(col, vec3f(1.0 / 2.2));
    
    // Vignette
    let q = uv - 0.5;
    col *= 1.0 - 0.5 * dot(q, q);

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
      title="Liquid Crystal Blobs"
      hint="Raymarched refractive metaballs warping a colorful procedural background."
      error={error ?? gpuError}
    >
      <canvas ref={canvasRef} width={1920} height={1080} style={{width:'100%',height:'100%',display:'block'}} className="demo-canvas" />
    </DemoShell>
  )
}
