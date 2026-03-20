import { useEffect, useRef, useState } from "react"
import { useWebGPU } from "./WebGPUContext.jsx"
import { DemoShell, configureCanvasSize, fullscreenPipeline, startLoop, usePointer } from "./webgpuCommon.jsx"

export default function LiquidGeometryDemo() {
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

fn matRotateZ(rad: f32) -> mat3x3<f32> {
    let c = cos(rad); let s = sin(rad);
    return mat3x3<f32>(c, -s, 0.0, s, c, 0.0, 0.0, 0.0, 1.0);
}

fn smin(a: f32, b: f32, k: f32) -> f32 {
    let h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
    return mix(b, a, h) - k * h * (1.0 - h);
}

fn sdSphere(p: vec3f, s: f32) -> f32 {
    return length(p) - s;
}

fn sdBox(p: vec3f, b: vec3f) -> f32 {
    let d = abs(p) - b;
    return length(max(d, vec3f(0.0))) + min(max(d.x, max(d.y, d.z)), 0.0);
}

fn sdTorus(p: vec3f, t: vec2f) -> f32 {
    let q = vec2f(length(p.xz) - t.x, p.y);
    return length(q) - t.y;
}

fn map(p: vec3f) -> f32 {
    let t = u.time * 0.5;
    
    // Position 1: Center Sphere
    let dSphere = sdSphere(p, 0.8 + 0.1 * sin(t * 3.0));
    
    // Position 2: Orbiting Box
    var boxPos = p - vec3f(sin(t * 1.5) * 1.5, cos(t * 1.3) * 1.0, cos(t * 1.5) * 1.5);
    boxPos = matRotateX(t) * matRotateY(t * 1.2) * boxPos;
    let dBox = sdBox(boxPos, vec3f(0.4));
    
    // Position 3: Orbiting Torus
    var torusPos = p - vec3f(cos(t * 1.2) * -1.8, sin(t) * 1.5, sin(t * 1.2) * 1.8);
    torusPos = matRotateX(t * 0.8) * matRotateZ(t * 0.5) * torusPos;
    let dTorus = sdTorus(torusPos, vec2f(0.6, 0.2));
    
    // Position 4: Second smaller sphere
    let sphere2Pos = p - vec3f(sin(t * 2.0) * 1.2, cos(t * 2.5) * 1.2, sin(t * 1.8) * 1.2);
    let dSphere2 = sdSphere(sphere2Pos, 0.3);
    
    var d = smin(dSphere, dBox, 0.6);
    d = smin(d, dTorus, 0.6);
    d = smin(d, dSphere2, 0.5);
    
    // Small ripples
    d -= 0.02 * sin(10.0 * p.x + u.time * 5.0) * sin(10.0 * p.y + u.time * 3.0);
    
    return d;
}

fn calcNormal(p: vec3f) -> vec3f {
    let e = vec2f(0.001, 0.0);
    return normalize(vec3f(
        map(p + e.xyy) - map(p - e.xyy),
        map(p + e.yxy) - map(p - e.yxy),
        map(p + e.yyx) - map(p - e.yyx)
    ));
}

fn palette(t: f32) -> vec3f {
    let a = vec3f(0.5, 0.5, 0.5);
    let b = vec3f(0.5, 0.5, 0.5);
    let c = vec3f(1.0, 1.0, 1.0);
    let d = vec3f(0.0, 0.33, 0.67);
    return a + b * cos(6.28318 * (c * t + d));
}

@fragment
fn fsMain(@location(0) uv: vec2f) -> @location(0) vec4f {
    let aspect = u.w / u.h;
    var p = (uv - 0.5) * vec2f(aspect, 1.0);
    
    let mx = (u.mx - 0.5) * 6.28;
    let my = -(u.my - 0.5) * 3.14;
    
    var ro = vec3f(0.0, 0.0, 4.5);
    var rd = normalize(vec3f(p, -1.0));
    
    let rotX = matRotateX(my);
    let rotY = matRotateY(mx + u.time * 0.1);
    
    ro = rotY * rotX * ro;
    rd = rotY * rotX * rd;
    
    var t = 0.0;
    var hit = false;
    var pos = ro;
    
    for(var i = 0; i < 100; i++) {
        pos = ro + rd * t;
        let d = map(pos);
        if(d < 0.001) {
            hit = true;
            break;
        }
        t += d;
        if(t > 15.0) { break; }
    }
    
    // Background
    var col = vec3f(0.02, 0.05, 0.1) * (1.0 - 0.5 * length(p));
    
    if (hit) {
        let n = calcNormal(pos);
        let lig = normalize(vec3f(1.0, 2.0, 1.0));
        let lig2 = normalize(vec3f(-2.0, -1.0, -1.0));
        
        let dif1 = max(0.0, dot(n, lig));
        let dif2 = max(0.0, dot(n, lig2));
        
        // Iridescent reflection based on view angle and normal
        let fre = pow(1.0 - max(dot(n, -rd), 0.0), 3.0);
        
        // Color mapping from normal
        let baseCol = palette(length(pos) * 0.2 + u.time * 0.2 + dot(n, vec3f(0.0, 1.0, 0.0)) * 0.5);
        
        let spec = pow(max(dot(reflect(rd, n), lig), 0.0), 32.0);
        
        col = baseCol * (dif1 * 0.8 + 0.2);
        col += vec3f(0.2, 0.4, 0.8) * dif2 * 0.5;
        col += vec3f(1.0) * spec * 0.8;
        col += palette(fre * 1.5 + u.time * 0.5) * fre * 1.2;
    }
    
    // Tone mapping
    col = col / (1.0 + col);
    col = pow(col, vec3f(1.0 / 2.2));

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
      title="Liquid Geometry"
      hint="Raymarched metallic geometric solids melting into one another."
      error={error ?? gpuError}
    >
      <canvas ref={canvasRef} width={1920} height={1080} style={{width:'100%',height:'100%',display:'block'}} className="demo-canvas" />
    </DemoShell>
  )
}
