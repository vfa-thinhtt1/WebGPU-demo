import { useEffect, useRef, useState } from "react"
import { useWebGPU } from "./WebGPUContext.jsx"
import { DemoShell, configureCanvasSize, fullscreenPipeline, startLoop, usePointer } from "./webgpuCommon.jsx"

export default function CyberHeartDemo() {
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

fn smax(a: f32, b: f32, k: f32) -> f32 {
    let h = max(k - abs(a - b), 0.0);
    return max(a, b) + h * h * 0.25 / k;
}

// Custom heart SDF
fn sdHeart(p_in: vec3f) -> f32 {
    var p = p_in;
    // Rotate heart so it faces front properly
    p = matRotateY(3.14159 / 2.0) * p; 
    
    // Heart math formula shaping
    // Move up to center
    p.y -= 0.2;
    p.z *= 0.5; // flatten depth
    p.y -= 0.5 * sqrt(abs(p.x));
    return length(p) - 0.8;
}

fn map(p: vec3f) -> vec2f {
    // Beating animation
    // u.time speed 
    let beatTime = u.time * 2.0;
    // Heartbeat shape graph
    let beat = 1.0 + 0.15 * exp(-fract(beatTime) * 10.0) + 0.05 * exp(-fract(beatTime + 0.3) * 10.0);
    
    var q = p / beat;
    let dHeart = sdHeart(q) * beat;
    
    // Grid cutting into the heart to make it look like tech wires
    let gridX = abs(fract(q.x * 10.0) - 0.5) * 0.2;
    let gridY = abs(fract(q.y * 10.0 - u.time) - 0.5) * 0.2;
    let gridZ = abs(fract(q.z * 10.0) - 0.5) * 0.2;
    
    let wire = max(dHeart, min(min(gridX, gridY), gridZ)) * beat;
    
    // Core of the heart
    let core = sdHeart(q * 1.5) / 1.5 * beat;

    if (core < wire) {
        return vec2f(core, 2.0); // 2 = Core
    }
    return vec2f(wire, 1.0); // 1 = Tech Wires
}

fn calcNormal(p: vec3f) -> vec3f {
    let e = vec2f(0.001, 0.0);
    return normalize(vec3f(
        map(p + e.xyy).x - map(p - e.xyy).x,
        map(p + e.yxy).x - map(p - e.yxy).x,
        map(p + e.yyx).x - map(p - e.yyx).x
    ));
}

@fragment
fn fsMain(@location(0) uv: vec2f) -> @location(0) vec4f {
    let aspect = u.w / u.h;
    var p = (uv - 0.5) * vec2f(aspect, 1.0);
    
    var ro = vec3f(0.0, 0.0, 3.5);
    var rd = normalize(vec3f(p, -1.0));
    
    let mx = (u.mx - 0.5) * 6.28;
    let my = -(u.my - 0.5) * 3.14;
    
    let rotX = matRotateX(my);
    let rotY = matRotateY(mx + u.time * 0.5); // auto spin
    
    ro = rotY * rotX * ro;
    rd = rotY * rotX * rd;
    
    var t = 0.0;
    var id = 0.0;
    var glowCore = 0.0;
    var glowWire = 0.0;
    
    var hit = false;
    var pos = ro;
    
    for(var i = 0; i < 80; i++) {
        pos = ro + rd * t;
        let res = map(pos);
        let d = res.x;
        id = res.y;
        
        if (id == 1.0) {
            glowWire += 0.01 / (0.01 + abs(d));
        } else if (id == 2.0) {
            glowCore += 0.02 / (0.01 + abs(d));
        }
        
        if(d < 0.001) {
            hit = true;
            break;
        }
        t += d * 0.5; // step size reduced for precision on wires
        if(t > 10.0) { break; }
    }
    
    var col = vec3f(0.05, 0.01, 0.05); // dark background
    
    // Tech background grid
    let bgGrid = abs(fract(rd.x * 20.0 + u.time) - 0.5) * abs(fract(rd.y * 20.0) - 0.5);
    col += vec3f(0.2, 0.0, 0.3) * smoothstep(0.1, 0.0, bgGrid);
    
    if (hit) {
        let n = calcNormal(pos);
        var lig = normalize(vec3f(1.0, 1.0, 1.0));
        var dif = max(0.0, dot(n, lig));
        var fre = pow(1.0 - max(dot(n, -rd), 0.0), 2.0);
        
        if (id == 1.0) {
            // Wires material
            let wireColor = vec3f(1.0, 0.1, 0.5);
            col = wireColor * dif * 0.5 + wireColor * fre;
        } else if (id == 2.0) {
            // Core material
            let coreColor = vec3f(1.0, 0.8, 0.9);
            col = coreColor * dif + coreColor * fre * 2.0;
        }
    }
    
    // Add volumetric glows
    let coreGlowColor = vec3f(1.0, 0.2, 0.4);
    let wireGlowColor = vec3f(0.8, 0.1, 1.0);
    
    col += coreGlowColor * glowCore * 0.03;
    col += wireGlowColor * glowWire * 0.015;
    
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
      title="Cyber Heart"
      hint="A beating, wireframe cybernetic heart with neon glow."
      error={error ?? gpuError}
    >
      <canvas ref={canvasRef} width={1920} height={1080} style={{width:'100%',height:'100%',display:'block'}} className="demo-canvas" />
    </DemoShell>
  )
}
