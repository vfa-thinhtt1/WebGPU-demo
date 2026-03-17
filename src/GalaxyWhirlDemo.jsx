import { useEffect, useRef, useState } from "react"
import { useWebGPU } from "./WebGPUContext.jsx"
import {
  DemoShell,
  configureCanvasSize,
  startLoop,
  usePointer,
} from "./webgpuCommon.jsx"

// 1,572,864 particles (24576 * 64)
const NUM_PARTICLES = 1572864
const WORKGROUP_SIZE = 64

export default function GalaxyWhirlDemo() {
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
          const computeCode = /* wgsl */ `
            struct Particle {
              pos : vec2f,
              vel : vec2f,
              color_idx : f32,
              padding : f32,
            };
            @group(0) @binding(0) var<storage, read_write> particles : array<Particle>;
            
            struct Params {
              time : f32,
              dt : f32,
              mx : f32,
              my : f32,
              down : f32,
            };
            @group(0) @binding(1) var<uniform> p : Params;

            @compute @workgroup_size(${WORKGROUP_SIZE})
            fn main(@builtin(global_invocation_id) id: vec3u) {
              let idx = id.x;
              if (idx >= ${NUM_PARTICLES}u) { return; }

              var prt = particles[idx];
              let dt = p.dt;
              let m = vec2f(p.mx, p.my);
              
              // Orbital forces
              let r = length(prt.pos);
              let force_dir = -prt.pos / (r + 0.01);
              
              // Central attraction (Black hole-like)
              let gravity = force_dir * (0.6 / (r * r + 0.2));
              
              // Spiral momentum
              let spiral = vec2f(-prt.pos.y, prt.pos.x) * (0.15 / (r + 0.5));
              
              // Mouse influence
              let m_pos = (m - 0.5) * vec2f(2.5, 2.5);
              let m_delta = prt.pos - m_pos;
              let m_dist = length(m_delta);
              let m_force = normalize(vec2f(-m_delta.y, m_delta.x)) * (1.2 / (m_dist + 0.2)) * p.down;

              prt.vel += (gravity + spiral + m_force) * dt;
              prt.pos += prt.vel * dt;
              
              // Friction
              prt.vel *= 0.992;

              particles[idx] = prt;
            }
          `;

          const renderCode = /* wgsl */ `
            struct Particle {
              pos : vec2f,
              vel : vec2f,
              color_idx : f32,
              padding : f32,
            };
            @group(0) @binding(0) var<storage, read> particles : array<Particle>;
            @group(0) @binding(1) var<uniform> aspect : f32;

            struct VSOut {
              @builtin(position) pos : vec4f,
              @location(0) color : vec3f,
            };

            fn palette(t: f32) -> vec3f {
              return 0.5 + 0.5 * cos(6.28318 * (vec3f(0.0, 0.1, 0.2) + t));
            }

            @vertex
            fn vsMain(@builtin(vertex_index) vIdx: u32) -> VSOut {
              let prt = particles[vIdx];
              
              var out: VSOut;
              out.pos = vec4f(prt.pos.x / aspect, prt.pos.y, 0.0, 1.0);
              
              let v = length(prt.vel);
              let d = length(prt.pos);
              
              // Brightness modulation
              out.color = palette(prt.color_idx + d * 0.1) * (0.2 + v * 3.5) * smoothstep(3.0, 0.0, d);
              
              return out;
            }

            @fragment
            fn fsMain(in: VSOut) -> @location(0) vec4f {
              return vec4f(in.color, 1.0);
            }
          `;

          // --- Buffers ---
          const initialData = new Float32Array(NUM_PARTICLES * 6)
          for (let i = 0; i < NUM_PARTICLES; i++) {
            const angle = Math.random() * Math.PI * 2
            const r = 0.1 + Math.pow(Math.random(), 1.5) * 2.0

            initialData[i * 6 + 0] = Math.cos(angle) * r
            initialData[i * 6 + 1] = Math.sin(angle) * r
            initialData[i * 6 + 2] = -Math.sin(angle) * 0.4
            initialData[i * 6 + 3] = Math.cos(angle) * 0.4
            initialData[i * 6 + 4] = Math.random()
            initialData[i * 6 + 5] = 0
          }

          const particleBuffer = device.createBuffer({
            size: initialData.byteLength,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
            mappedAtCreation: true,
          })
          new Float32Array(particleBuffer.getMappedRange()).set(initialData)
          particleBuffer.unmap()

          const computeParamsBuffer = device.createBuffer({
            size: 32, // Struct takes ~20, but round to 16-block
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
          })

          const renderParamsBuffer = device.createBuffer({
            size: 16,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
          })

          // --- Pipelines ---
          const computePipeline = device.createComputePipeline({
            layout: "auto",
            compute: { module: device.createShaderModule({ code: computeCode }), entryPoint: "main" },
          })

          const renderPipeline = device.createRenderPipeline({
            layout: "auto",
            vertex: { module: device.createShaderModule({ code: renderCode }), entryPoint: "vsMain" },
            fragment: {
              module: device.createShaderModule({ code: renderCode }),
              entryPoint: "fsMain",
              targets: [{
                format,
                blend: {
                  color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
                  alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
                }
              }],
            },
            primitive: { topology: "point-list" },
          })

          const computeBG = device.createBindGroup({
            layout: computePipeline.getBindGroupLayout(0),
            entries: [
              { binding: 0, resource: { buffer: particleBuffer } },
              { binding: 1, resource: { buffer: computeParamsBuffer } },
            ],
          })

          const renderBG = device.createBindGroup({
            layout: renderPipeline.getBindGroupLayout(0),
            entries: [
              { binding: 0, resource: { buffer: particleBuffer } },
              { binding: 1, resource: { buffer: renderParamsBuffer } },
            ],
          })

          const onResize = () => configureCanvasSize(canvas, context, device, format)
          onResize()
          window.addEventListener("resize", onResize)

          let lastTime = performance.now()
          stop = startLoop((time) => {
            const now = performance.now()
            const dt = Math.min((now - lastTime) / 1000, 0.05)
            lastTime = now

            const ptr = pointerRef.current
            const { width, height } = configureCanvasSize(canvas, context, device, format)

            // Uniform writing
            const paramsData = new Float32Array([time, dt, ptr.x, ptr.y, ptr.down ? 1 : 0, 0, 0, 0])
            device.queue.writeBuffer(computeParamsBuffer, 0, paramsData)
            device.queue.writeBuffer(renderParamsBuffer, 0, new Float32Array([width / height, 0, 0, 0]))

            const encoder = device.createCommandEncoder()

            const cPass = encoder.beginComputePass()
            cPass.setPipeline(computePipeline)
            cPass.setBindGroup(0, computeBG)
            cPass.dispatchWorkgroups(Math.ceil(NUM_PARTICLES / WORKGROUP_SIZE))
            cPass.end()

            const rPass = encoder.beginRenderPass({
              colorAttachments: [{
                view: context.getCurrentTexture().createView(),
                clearValue: { r: 0, g: 0, b: 0.01, a: 1 },
                loadOp: "clear", storeOp: "store",
              }],
            })
            rPass.setPipeline(renderPipeline)
            rPass.setBindGroup(0, renderBG)
            rPass.draw(NUM_PARTICLES, 1)
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
      title="Galaxy Whirl"
      hint="1.5 Million particles in a spiraling simulation. Click and drag to create a vacuum vortex."
      error={error ?? gpuError}
    >
      <canvas ref={canvasRef} width={1920} height={1080} style={{ width: '100%', height: '100%', display: 'block' }} className="demo-canvas" />
    </DemoShell>
  )
}
