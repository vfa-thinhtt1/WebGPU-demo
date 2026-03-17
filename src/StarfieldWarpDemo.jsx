import { useEffect, useRef, useState } from "react"
import { useWebGPU } from "./WebGPUContext.jsx"
import {
  DemoShell,
  configureCanvasSize,
  startLoop,
  usePointer,
} from "./webgpuCommon.jsx"

const NUM_STARS = 65536
const WORKGROUP_SIZE = 64

export default function StarfieldWarpDemo() {
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
          context = canvas.getContext("webgpu")
          context.configure({ device, format, alphaMode: "premultiplied" })

          if (cancelled) { context.unconfigure(); return }

          // --- Shaders ---
          const computeModule = device.createShaderModule({
            code: /* wgsl */ `
            struct Star {
              pos : vec3f,
              vel : f32,
            };
            @group(0) @binding(0) var<storage, read_write> stars : array<Star>;
            @group(0) @binding(1) var<uniform> params : vec4f; // time, dt, mx, my

            fn hash(p: f32) -> f32 {
              return fract(sin(p) * 43758.5453);
            }

            @compute @workgroup_size(${WORKGROUP_SIZE})
            fn main(@builtin(global_invocation_id) id: vec3u) {
              let idx = id.x;
              if (idx >= ${NUM_STARS}u) { return; }

              var s = stars[idx];
              let dt = params.y;
              let warp = 1.0 + params.w * 5.0; // Boost speed on click

              // Move forward (z-axis)
              s.pos.z -= s.vel * dt * 20.0 * warp;

              // Reset if behind camera
              if (s.pos.z < -2.0) {
                s.pos.z = 20.0;
                s.pos.x = (hash(f32(idx) + params.x) - 0.5) * 40.0;
                s.pos.y = (hash(f32(idx) * 1.34 + params.x) - 0.5) * 40.0;
              }

              stars[idx] = s;
            }
          `,
          })

          const renderModule = device.createShaderModule({
            code: /* wgsl */ `
            struct Star {
              pos : vec3f,
              vel : f32,
            };
            @group(0) @binding(0) var<storage, read> stars : array<Star>;
            @group(0) @binding(1) var<uniform> params : vec4f; // time, aspect, mx, my

            struct VSOut {
              @builtin(position) pos: vec4f,
              @location(0) color: vec3f,
            };

            @vertex
            fn vsMain(@builtin(vertex_index) vIdx: u32, @builtin(instance_index) iIdx: u32) -> VSOut {
              let s = stars[iIdx];
              let aspect = params.y;
              let warp = 1.0 + params.w * 3.0;
              
              // Trail logic: vIdx 0 is head, 1 is tail
              var p = s.pos;
              if (vIdx == 1u) {
                p.z += s.vel * 0.1 * warp; // Stretch tail back
              }

              // Mouse offset (steering)
              let m = (vec2f(params.z, params.w) - 0.5) * 0.5;
              p.x -= m.x * p.z;
              p.y += m.y * p.z;

              // Project
              var out: VSOut;
              let z_scaled = max(0.1, p.z);
              out.pos = vec4f(p.x / (z_scaled * aspect), p.y / z_scaled, 0.5, 1.0);
              
              // Fade based on distance and warp
              let brightness = clamp(1.0 - p.z / 20.0, 0.0, 1.0);
              out.color = vec3f(0.8, 0.9, 1.0) * brightness * warp;
              
              return out;
            }

            @fragment
            fn fsMain(in: VSOut) -> @location(0) vec4f {
              return vec4f(in.color, 1.0);
            }
          `,
          })

          // --- Buffers ---
          const initialData = new Float32Array(NUM_STARS * 4)
          for (let i = 0; i < NUM_STARS; i++) {
            initialData[i * 4 + 0] = (Math.random() - 0.5) * 40
            initialData[i * 4 + 1] = (Math.random() - 0.5) * 40
            initialData[i * 4 + 2] = Math.random() * 20
            initialData[i * 4 + 3] = 0.5 + Math.random() * 2.0 // velocity
          }

          const starBuffer = device.createBuffer({
            size: initialData.byteLength,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
            mappedAtCreation: true,
          })
          new Float32Array(starBuffer.getMappedRange()).set(initialData)
          starBuffer.unmap()

          const simParamsBuffer = device.createBuffer({
            size: 16,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
          })

          const renderParamsBuffer = device.createBuffer({
            size: 16,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
          })

          // --- Pipelines ---
          const computePipeline = device.createComputePipeline({
            layout: "auto",
            compute: { module: computeModule, entryPoint: "main" },
          })

          const renderPipeline = device.createRenderPipeline({
            layout: "auto",
            vertex: { module: renderModule, entryPoint: "vsMain" },
            fragment: {
              module: renderModule,
              entryPoint: "fsMain",
              targets: [{
                format,
                blend: {
                  color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
                  alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
                }
              }],
            },
            primitive: { topology: "line-list" },
          })

          const computeBindGroup = device.createBindGroup({
            layout: computePipeline.getBindGroupLayout(0),
            entries: [
              { binding: 0, resource: { buffer: starBuffer } },
              { binding: 1, resource: { buffer: simParamsBuffer } },
            ],
          })

          const renderBindGroup = device.createBindGroup({
            layout: renderPipeline.getBindGroupLayout(0),
            entries: [
              { binding: 0, resource: { buffer: starBuffer } },
              { binding: 1, resource: { buffer: renderParamsBuffer } },
            ],
          })

          const onResize = () => configureCanvasSize(canvas, context, device, format)
          onResize()
          window.addEventListener("resize", onResize)

          let lastTime = performance.now()
          stop = startLoop((time) => {
            const now = performance.now()
            const dt = (now - lastTime) / 1000
            lastTime = now

            const ptr = pointerRef.current
            const { width, height } = configureCanvasSize(canvas, context, device, format)

            device.queue.writeBuffer(simParamsBuffer, 0, new Float32Array([time, dt, ptr.x, ptr.down ? 1 : 0]))
            device.queue.writeBuffer(renderParamsBuffer, 0, new Float32Array([time, width / height, ptr.x, ptr.down ? 1 : 0]))

            const encoder = device.createCommandEncoder()
            
            const cPass = encoder.beginComputePass()
            cPass.setPipeline(computePipeline)
            cPass.setBindGroup(0, computeBindGroup)
            cPass.dispatchWorkgroups(Math.ceil(NUM_STARS / WORKGROUP_SIZE))
            cPass.end()

            const rPass = encoder.beginRenderPass({
              colorAttachments: [{
                view: context.getCurrentTexture().createView(),
                clearValue: { r: 0, g: 0, b: 0.05, a: 1 },
                loadOp: "clear", storeOp: "store",
              }],
            })
            rPass.setPipeline(renderPipeline)
            rPass.setBindGroup(0, renderBindGroup)
            rPass.draw(2, NUM_STARS)
            rPass.end()

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
      title="Starfield Warp"
      hint="Warp through space. Move mouse to steer, click to boost into hyperdrive."
      error={error ?? gpuError}
    >
      <canvas ref={canvasRef} width={1920} height={1080} style={{ width: '100%', height: '100%', display: 'block' }} className="demo-canvas" />
    </DemoShell>
  )
}
