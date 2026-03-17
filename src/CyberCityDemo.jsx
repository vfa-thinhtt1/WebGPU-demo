import { useEffect, useRef, useState } from "react"
import { useWebGPU } from "./WebGPUContext.jsx"
import {
  DemoShell,
  configureCanvasSize,
  fullscreenPipeline,
  startLoop,
  usePointer,
} from "./webgpuCommon.jsx"

export default function CyberCityDemo() {
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
            size: 32, // time, w, h, mx, my, mdx, mdy, down
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

            // ── SDF Lib ───────────────────────────────────────────────────────────────

            fn hash21(p: vec2f) -> f32 {
              let q = fract(p * vec2f(123.34, 456.21));
              return fract(dot(q, q + 45.32));
            }

            fn box(p: vec3f, b: vec3f) -> f32 {
              let q = abs(p) - b;
              return length(max(q, vec3f(0.0))) + min(max(q.x, max(q.y, q.z)), 0.0);
            }

            fn map(p: vec3f) -> vec2f {
              let id = floor(p.xz * 0.4);
              var q = p;
              q.x = (fract(p.x * 0.4 + 0.5) - 0.5) / 0.4;
              q.z = (fract(p.z * 0.4 + 0.5) - 0.5) / 0.4;
              
              let h = hash21(id) * 3.5 + 1.0;
              // Main building body
              var d = box(q - vec3f(0.0, h * 0.5, 0.0), vec3f(0.65, h * 0.5, 0.65));
              
              // Add a smaller top block
              let h_top = h + 0.5;
              let d_top = box(q - vec3f(0.0, h_top, 0.0), vec3f(0.3, 0.5, 0.3));
              d = min(d, d_top);
              
              // Add a base platform
              let d_base = box(q - vec3f(0.0, 0.1, 0.0), vec3f(0.75, 0.1, 0.75));
              d = min(d, d_base);
              
              return vec2f(d, hash21(id));
            }

            @fragment
            fn fsMain(@location(0) uv: vec2f) -> @location(0) vec4f {
              let aspect = u.w / u.h;
              let p = (uv - 0.5) * vec2f(aspect, 1.0);
              
              // Camera - Offset to the right to move through the "street"
              let speed = 2.2;
              let ro = vec3f(1.25, 4.0, u.time * speed);
              let lookAt = ro + vec3f(sin(u.mx * 3.0 - 1.5) * 2.0, (0.2 - u.my) * 3.0, 1.0);
              let fwd = normalize(lookAt - ro);
              let right = normalize(cross(vec3f(0,1,0), fwd));
              let up = cross(fwd, right);
              let rd = normalize(fwd + p.x * right + p.y * up);

              // 1. Precise Raymarching
              var t = 0.01;
              var hit = false;
              var res = vec2f(0.0);
              for(var i=0; i<128; i++) {
                res = map(ro + rd * t);
                if(res.x < 0.0004) { hit = true; break; }
                t += res.x * 0.6;
                if(t > 70.0) { break; }
              }

              // 2. Sky Gradient
              var col = mix(vec3f(0.005, 0.0, 0.02), vec3f(0.03, 0.01, 0.08), exp(-abs(p.y)*2.5));
              
              if(hit) {
                let pos = ro + rd * t;
                let id_h = res.y;
                let h_val = id_h * 3.5 + 1.0;
                
                // 3. High-quality Normals
                let e = vec2f(0.001, 0.0);
                let nor = normalize(vec3f(
                    map(pos + e.xyy).x - map(pos - e.xyy).x,
                    map(pos + e.yxy).x - map(pos - e.yxy).x,
                    map(pos + e.yyx).x - map(pos - e.yyx).x
                ));

                // 4. Lighting: Diffuse + Rim + AO
                // Base Dark Material
                col = vec3f(0.002, 0.002, 0.005);
                
                // Rim lighting (Edge highlights)
                let rim = pow(1.0 + dot(rd, nor), 3.0);
                col += vec3f(0.3, 0.5, 1.0) * rim * 0.05;

                // Fake Ambient Occlusion (darken corners)
                var ao = 1.0;
                let ao_step = 0.1;
                ao -= (ao_step - map(pos + nor * ao_step).x) * 1.5;
                col *= max(ao, 0.1);

                // Diffuse key light
                let diff = max(dot(nor, normalize(vec3f(1.0, 2.0, -1.0))), 0.0);
                col += diff * 0.015;

                // 5. Texture & Windows
                // Surface floors/panels
                let panels = smoothstep(0.02, 0.0, abs(fract(pos.y * 3.0) - 0.5));
                col += panels * 0.005;

                // AA Windows
                let w_freq = vec2f(6.0, 4.0);
                let w_uv = vec2f(pos.x + pos.z, pos.y) * w_freq;
                let w_f = abs(fract(w_uv) - 0.5);
                let w_mask = smoothstep(0.42, 0.38, w_f.x) * smoothstep(0.45, 0.4, w_f.y);
                
                let win_id = hash21(floor(w_uv) + id_h);
                if(w_mask > 0.05 && win_id > 0.65) {
                   let glow = 0.5 + 0.5 * cos(6.28318 * (vec3f(0.0, 0.2, 0.4) + id_h * 8.0));
                   col += glow * w_mask * 1.5;
                }
                
                // Stable pulsing Beacons
                if(pos.y > (h_val + 0.4)) {
                   let b_pulse = smoothstep(0.3, 0.7, sin(u.time * 6.0 + id_h * 30.0));
                   col = mix(col, vec3f(1.0, 0.0, 0.3), b_pulse * 0.9);
                }

                // Clean Depth Haze
                col = mix(col, vec3f(0.005, 0.0, 0.02), smoothstep(25.0, 70.0, t));
              }

              // 6. Final Polish: Bloom + Horizon
              col += vec3f(0.5, 0.1, 0.9) * exp(-abs(p.y + 0.3) * 8.0) * 0.25;
              
              // Gamma Correction
              col = pow(col, vec3f(0.4545)); 
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
              ptr.x, ptr.y, ptr.dx, ptr.dy, ptr.down ? 1 : 0
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
      title="Cyber City"
      hint="Infinite procedural skyline. Move mouse to look around."
      error={error ?? gpuError}
    >
      <canvas ref={canvasRef} width={1920} height={1080} style={{ width: '100%', height: '100%', display: 'block' }} className="demo-canvas" />
    </DemoShell>
  )
}
