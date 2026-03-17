import { useEffect, useRef, useState } from "react"
import { useWebGPU } from "./WebGPUContext.jsx"
import {
  DemoShell,
  configureCanvasSize,
  fullscreenPipeline,
  startLoop,
  usePointer,
} from "./webgpuCommon.jsx"

export default function BioBlobsDemo() {
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
            size: 64, // time, w, h, mx, my, mdx, mdy, down + 8 floats for blob positions
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
              b1x  : f32, b1y  : f32,
              b2x  : f32, b2y  : f32,
              b3x  : f32, b3y  : f32,
              b4x  : f32, b4y  : f32,
            };
            @group(0) @binding(0) var<uniform> u: U;

            fn smin(a: f32, b: f32, k: f32) -> f32 {
              let h = max(k - abs(a - b), 0.0) / k;
              return min(a, b) - h * h * h * k * (1.0/6.0);
            }

            fn sdSphere(p: vec3f, s: f32) -> f32 {
              return length(p) - s;
            }

            fn map(p: vec3f) -> f32 {
              let m = (vec2f(u.mx, u.my) - 0.5) * 2.5;
              let dMouse = sdSphere(p - vec3f(m.x, -m.y, 0.0), 0.25 + u.down * 0.15);
              
              let d1 = sdSphere(p - vec3f(u.b1x, u.b1y, sin(u.time * 0.5) * 0.5), 0.3);
              let d2 = sdSphere(p - vec3f(u.b2x, u.b2y, cos(u.time * 0.7) * 0.5), 0.35);
              let d3 = sdSphere(p - vec3f(u.b3x, u.b3y, sin(u.time * 0.9) * 0.5), 0.28);
              let d4 = sdSphere(p - vec3f(u.b4x, u.b4y, cos(u.time * 1.1) * 0.5), 0.32);
              
              var d = smin(dMouse, d1, 0.4);
              d = smin(d, d2, 0.4);
              d = smin(d, d3, 0.4);
              d = smin(d, d4, 0.4);
              
              return d;
            }

            fn getNormal(p: vec3f) -> vec3f {
              let e = vec2f(0.001, 0.0);
              return normalize(vec3f(
                map(p + e.xyy) - map(p - e.xyy),
                map(p + e.yxy) - map(p - e.yxy),
                map(p + e.yyx) - map(p - e.yyx)
              ));
            }

            @fragment
            fn fsMain(@location(0) uv: vec2f) -> @location(0) vec4f {
              let aspect = u.w / u.h;
              let p = (uv - 0.5) * vec2f(aspect, 1.0);
              
              let ro = vec3f(0.0, 0.0, 2.0);
              let rd = normalize(vec3f(p, -1.0));
              
              var t = 0.0;
              var hit = false;
              for(var i=0; i<64; i++) {
                let d = map(ro + rd * t);
                if(d < 0.001) { hit = true; break; }
                t += d;
                if(t > 10.0) { break; }
              }
              
              var col = vec3f(0.01, 0.02, 0.05); // Dark deep space
              
              if(hit) {
                let pos = ro + rd * t;
                let nor = getNormal(pos);
                let light = normalize(vec3f(1.0, 1.0, 1.0));
                let diff = max(dot(nor, light), 0.0);
                let fres = pow(1.0 + dot(rd, nor), 3.0);
                
                // Color based on normal and fresnel
                let baseCol = 0.5 + 0.5 * cos(6.28318 * (vec3f(0.0, 0.1, 0.2) + pos.y * 0.5 + u.time * 0.1));
                col = baseCol * diff + vec3f(0.0, 0.8, 1.0) * fres * 0.5;
                col += pow(max(dot(reflect(-light, nor), -rd), 0.0), 32.0); // Specular
              }

              // Subtle background glow
              col += vec3f(0.1, 0.05, 0.2) * (1.0 - length(p));
              
              col = pow(col, vec3f(0.4545)); // Gamma
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

            // Calculate moving blob positions
            const b1 = [Math.sin(time * 0.4) * 0.8, Math.cos(time * 0.6) * 0.4]
            const b2 = [Math.cos(time * 0.3) * 0.7, Math.sin(time * 0.5) * 0.6]
            const b3 = [Math.sin(time * 0.5) * 0.9, Math.sin(time * 0.3) * 0.5]
            const b4 = [Math.cos(time * 0.6) * 0.6, Math.cos(time * 0.4) * 0.7]

            device.queue.writeBuffer(uniformBuffer, 0, new Float32Array([
              time, width, height,
              ptr.x, 1 - ptr.y, ptr.dx, -ptr.dy, ptr.down ? 1 : 0,
              ...b1, ...b2, ...b3, ...b4
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
      title="Bio-Blobs"
      hint="Organic SDF metaballs. Hover to attract the blobs with your own field."
      error={error ?? gpuError}
    >
      <canvas ref={canvasRef} width={1920} height={1080} style={{ width: '100%', height: '100%', display: 'block' }} className="demo-canvas" />
    </DemoShell>
  )
}
