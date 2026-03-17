import { useEffect, useRef, useState } from "react"
import { useWebGPU } from "./WebGPUContext.jsx"
import {
  DemoShell,
  configureCanvasSize,
  fullscreenPipeline,
  startLoop,
  usePointer,
} from "./webgpuCommon.jsx"

export default function NeuralSynapseDemo() {
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

// ── Helpers ──────────────────────────────────────────────────────────────────

fn hash22(p: vec2f) -> vec2f {
    var p2 = vec2f(dot(p, vec2f(127.1, 311.7)), dot(p, vec2f(269.5, 183.3)));
    return fract(sin(p2) * 43758.5453123);
}

fn line(p: vec2f, a: vec2f, b: vec2f) -> f32 {
    let pa = p - a;
    let ba = b - a;
    let h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    return length(pa - ba * h);
}

// ── Main ─────────────────────────────────────────────────────────────────────

@fragment
fn fsMain(@location(0) uv: vec2f) -> @location(0) vec4f {
    let aspect = u.w / u.h;
    let p = (uv - 0.5) * vec2f(aspect, 1.0);
    let mouse = (vec2f(u.mx, u.my) - 0.5) * vec2f(aspect, 1.0);
    
    var col = vec3f(0.015, 0.02, 0.04); // Dark brain-matter blue
    
    let scale = 8.0;
    let gv = p * scale;
    let id = floor(gv);
    let fr = fract(gv);
    
    // Store points in a 3x3 neighborhood
    var points = array<vec2f, 9>();
    var idx = 0;
    for (var y = -1; y <= 1; y++) {
        for (var x = -1; x <= 1; x++) {
            let offs = vec2f(f32(x), f32(y));
            let n = hash22(id + offs);
            // Animate points subtly
            let p_anim = offs + sin(u.time * 0.5 + n * 6.28) * 0.4;
            points[idx] = p_anim;
            idx++;
        }
    }
    
    // Draw connections and pulses
    for (var i = 0; i < 9; i++) {
        let p1 = points[i];
        
        // Connect to neighbors
        for (var j = i + 1; j < 9; j++) {
            let p2 = points[j];
            let d = length(p1 - p2);
            if (d < 1.5) {
                let l = line(fr, p1, p2);
                
                // Base connection fiber
                let fiber = smoothstep(0.02, 0.0, l) * smoothstep(1.5, 0.5, d) * 0.15;
                col += vec3f(0.1, 0.4, 0.8) * fiber;
                
                // Synaptic pulse
                // Pulse speed and timing depends on the link
                let pulse_id = hash22(id + p1 + p2).x;
                let speed = 0.5 + pulse_id * 1.5;
                let pulse_t = fract(u.time * speed + pulse_id * 10.0);
                
                // Pulse position along the line
                let pulse_pos = mix(p1, p2, pulse_t);
                let p_dist = length(fr - pulse_pos);
                
                // Interaction influence
                let m_dist = length((id + pulse_pos) / scale - mouse);
                let interaction = smoothstep(0.4, 0.0, m_dist) * u.down;
                
                let pulse_size = 0.05 + interaction * 0.1;
                let pulse_glow = smoothstep(pulse_size, 0.0, p_dist);
                let pulse_col = mix(vec3f(0.2, 0.6, 1.0), vec3f(0.8, 0.9, 1.0), interaction);
                
                col += pulse_col * pulse_glow * (interaction * 2.0 + 1.0) * smoothstep(1.5, 0.8, d);
            }
        }
        
        // Draw Nodes (Neurons)
        let n_dist = length(fr - p1);
        let node_glow = smoothstep(0.1, 0.0, n_dist);
        col += vec3f(0.15, 0.3, 0.6) * node_glow * 0.4;
        col += vec3f(0.8, 0.9, 1.0) * smoothstep(0.03, 0.0, n_dist);
    }
    
    // Vignette
    col *= 1.2 - length(p) * 0.8;
    
    // Bloom / Exposure
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
      title="Neural Synapse"
      hint="Watch the thoughts flow. Click to trigger intense neural activity where you touch."
      error={error ?? gpuError}
    >
      <canvas ref={canvasRef} width={1920} height={1080} style={{ width: '100%', height: '100%', display: 'block' }} className="demo-canvas" />
    </DemoShell>
  )
}
