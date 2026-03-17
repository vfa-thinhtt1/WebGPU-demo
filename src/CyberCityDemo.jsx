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
              
              let h = hash21(id) * 4.0 + 1.0;
              let d = box(q - vec3f(0.0, h * 0.5, 0.0), vec3f(0.6, h * 0.5, 0.6));
              
              return vec2f(d, hash21(id));
            }

            @fragment
            fn fsMain(@location(0) uv: vec2f) -> @location(0) vec4f {
              let aspect = u.w / u.h;
              let p = (uv - 0.5) * vec2f(aspect, 1.0);
              
              // Camera moving through city
              let speed = 2.0;
              let ro = vec3f(0.0, 1.2, u.time * speed);
              let lookAt = ro + vec3f(sin(u.mx * 2.0 - 1.0), (0.5 - u.my), 1.0);
              
              let fwd = normalize(lookAt - ro);
              let right = normalize(cross(vec3f(0,1,0), fwd));
              let up = cross(fwd, right);
              let rd = normalize(fwd + p.x * right + p.y * up);

              // Raymarching
              var t = 0.01;
              var hit = false;
              var res = vec2f(0.0);
              for(var i=0; i<80; i++) {
                res = map(ro + rd * t);
                if(res.x < 0.001) { hit = true; break; }
                t += res.x * 0.5;
                if(t > 40.0) { break; }
              }

              // Background
              var col = mix(vec3f(0.0, 0.0, 0.05), vec3f(0.1, 0.0, 0.2), exp(-abs(p.y)*2.0));
              
              if(hit) {
                let pos = ro + rd * t;
                let id_h = res.y;
                
                // Colors - building side
                col = vec3f(0.02, 0.02, 0.05);
                
                // Windows patterns
                let win = step(0.1, fract(pos.y * 3.0)) * step(0.1, fract(pos.x * 3.0 + pos.z * 3.0));
                let win_active = step(0.7, hash21(vec2f(floor(pos.y * 3.0), id_h)));
                
                if(win > 0.5 && win_active > 0.5) {
                   col += 0.5 + 0.5 * cos(6.28318 * (vec3f(0.0, 0.33, 0.67) + id_h));
                }
                
                // Top lights
                if(pos.y > (id_h * 4.0 + 0.9)) {
                   col += vec3f(1.0, 0.0, 0.2);
                }

                // Haze
                col = mix(col, vec3f(0.0, 0.0, 0.05), smoothstep(10.0, 40.0, t));
              }

              // Atmospheric bloom/glow
              col += vec3f(0.5, 0.2, 0.8) * exp(-abs(p.y) * 5.0) * 0.1;

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
