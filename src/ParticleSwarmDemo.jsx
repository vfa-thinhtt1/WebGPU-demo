import { useEffect, useRef, useState } from "react"
import { useWebGPU } from "./WebGPUContext.jsx"
import {
  DemoShell,
  configureCanvasSize,
  startLoop,
  usePointer,
} from "./webgpuCommon.jsx"

const NUM_PARTICLES = 1048576 // 2^20
const WORKGROUP_SIZE = 256

export default function ParticleSwarmDemo() {
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

          if (cancelled) {
            context.unconfigure()
            return
          }

          // --- Shaders ---

          const computeModule = device.createShaderModule({
            code: /* wgsl */ `
            struct Particle {
              pos : vec2f,
              vel : vec2f,
            };

            struct SimParams {
              time : f32,
              delta : f32,
              mouse : vec2f,
              mouseDown : f32,
            };

            @group(0) @binding(0) var<uniform> params : SimParams;
            @group(0) @binding(1) var<storage, read> particlesIn : array<Particle>;
            @group(0) @binding(2) var<storage, read_write> particlesOut : array<Particle>;

            @compute @workgroup_size(${WORKGROUP_SIZE})
            fn main(@builtin(global_invocation_id) id : vec3u) {
              let idx = id.x;
              if (idx >= ${NUM_PARTICLES}u) { return; }

              var p = particlesIn[idx];
              
              // Attraction to mouse
              let d = params.mouse - p.pos;
              let dist = length(d);
              let force = normalize(d) * (params.mouseDown * 0.5 + 0.05) / (dist * dist + 0.01);
              
              p.vel += force * params.delta * 0.5;
              p.vel *= 0.98; // Damping
              p.pos += p.vel * params.delta;

              // Boundaries
              if (p.pos.x < -1.0) { p.pos.x = -1.0; p.vel.x *= -0.5; }
              if (p.pos.x >  1.0) { p.pos.x =  1.0; p.vel.x *= -0.5; }
              if (p.pos.y < -1.0) { p.pos.y = -1.0; p.vel.y *= -0.5; }
              if (p.pos.y >  1.0) { p.pos.y =  1.0; p.vel.y *= -0.5; }

              particlesOut[idx] = p;
            }
          `,
          })

          const renderModule = device.createShaderModule({
            code: /* wgsl */ `
            struct Particle {
              pos : vec2f,
              vel : vec2f,
            };

            struct VSOut {
              @builtin(position) pos : vec4f,
              @location(0) color : vec4f,
            };

            @group(0) @binding(0) var<storage, read> particles : array<Particle>;

            @vertex
            fn vsMain(@builtin(vertex_index) idx : u32) -> VSOut {
              let p = particles[idx];
              var out : VSOut;
              out.pos = vec4f(p.pos, 0.0, 1.0);
              
              let speed = length(p.vel);
              let hue = speed * 0.5 + 0.6;
              out.color = vec4f(
                0.5 + 0.5 * sin(hue * 6.28),
                0.5 + 0.5 * sin((hue + 0.33) * 6.28),
                0.5 + 0.5 * sin((hue + 0.66) * 6.28),
                0.8
              );
              return out;
            }

            @fragment
            fn fsMain(in : VSOut) -> @location(0) vec4f {
              return in.color;
            }
          `,
          })

          // --- Buffers ---

          const initialData = new Float32Array(NUM_PARTICLES * 4)
          for (let i = 0; i < NUM_PARTICLES; i++) {
            initialData[i * 4 + 0] = (Math.random() - 0.5) * 2
            initialData[i * 4 + 1] = (Math.random() - 0.5) * 2
            initialData[i * 4 + 2] = 0
            initialData[i * 4 + 3] = 0
          }

          const particleBuffers = [
            device.createBuffer({
              size: initialData.byteLength,
              usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
              mappedAtCreation: true,
            }),
            device.createBuffer({
              size: initialData.byteLength,
              usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
            }),
          ]
          new Float32Array(particleBuffers[0].getMappedRange()).set(initialData)
          particleBuffers[0].unmap()

          const simParamsBuffer = device.createBuffer({
            size: 4 * 8, // time, delta, mouse.x, mouse.y, mouseDown, ...padding
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
                format, blend: {
                  color: { srcFactor: 'src-alpha', dstFactor: 'one', operation: 'add' },
                  alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
                }
              }],
            },
            primitive: { topology: "point-list" },
          })

          // --- Bind Groups ---

          const computeBindGroups = [
            device.createBindGroup({
              layout: computePipeline.getBindGroupLayout(0),
              entries: [
                { binding: 0, resource: { buffer: simParamsBuffer } },
                { binding: 1, resource: { buffer: particleBuffers[0] } },
                { binding: 2, resource: { buffer: particleBuffers[1] } },
              ],
            }),
            device.createBindGroup({
              layout: computePipeline.getBindGroupLayout(0),
              entries: [
                { binding: 0, resource: { buffer: simParamsBuffer } },
                { binding: 1, resource: { buffer: particleBuffers[1] } },
                { binding: 2, resource: { buffer: particleBuffers[0] } },
              ],
            }),
          ]

          const renderBindGroups = [
            device.createBindGroup({
              layout: renderPipeline.getBindGroupLayout(0),
              entries: [{ binding: 0, resource: { buffer: particleBuffers[1] } }],
            }),
            device.createBindGroup({
              layout: renderPipeline.getBindGroupLayout(0),
              entries: [{ binding: 0, resource: { buffer: particleBuffers[0] } }],
            }),
          ]

          let step = 0
          const onResize = () => configureCanvasSize(canvas, context, device, format)
          onResize()
          window.addEventListener("resize", onResize)

          let lastTime = performance.now()
          stop = startLoop((currentTime) => {
            const now = performance.now()
            const dt = Math.min(0.032, (now - lastTime) / 1000)
            lastTime = now

            const ptr = pointerRef.current
            const { width, height } = configureCanvasSize(canvas, context, device, format)
            const aspect = width / height

            device.queue.writeBuffer(
              simParamsBuffer,
              0,
              new Float32Array([
                currentTime,
                dt,
                (ptr.x - 0.5) * 2 * aspect,
                (0.5 - ptr.y) * 2,
                ptr.down ? 1 : 0,
              ])
            )

            const encoder = device.createCommandEncoder()

            // Compute
            const computePass = encoder.beginComputePass()
            computePass.setPipeline(computePipeline)
            computePass.setBindGroup(0, computeBindGroups[step % 2])
            computePass.dispatchWorkgroups(Math.ceil(NUM_PARTICLES / WORKGROUP_SIZE))
            computePass.end()

            // Render
            const renderPass = encoder.beginRenderPass({
              colorAttachments: [
                {
                  view: context.getCurrentTexture().createView(),
                  clearValue: { r: 0, g: 0, b: 0, a: 1 },
                  loadOp: "clear",
                  storeOp: "store",
                },
              ],
            })
            renderPass.setPipeline(renderPipeline)
            renderPass.setBindGroup(0, renderBindGroups[step % 2])
            renderPass.draw(NUM_PARTICLES)
            renderPass.end()

            device.queue.submit([encoder.finish()])
            step++
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
      try {
        context?.unconfigure()
      } catch (_) { }
    }
  }, [gpuState, pointerRef])

  return (
    <DemoShell
      title="Million Particles Swarm"
      hint="Move mouse to attract particles. Click to intensify attraction. Real-time compute simulation of 1,048,576 points."
      error={error ?? gpuError}
    >
      <canvas
        ref={canvasRef}
        width={1920}
        height={1080}
        style={{ width: "100%", height: "100%", display: "block" }}
        className="demo-canvas"
      />
    </DemoShell>
  )
}
