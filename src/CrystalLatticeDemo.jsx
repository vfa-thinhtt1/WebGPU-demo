import { useEffect, useRef, useState } from "react"
import { useWebGPU } from "./WebGPUContext.jsx"
import {
  DemoShell,
  configureCanvasSize,
  startLoop,
  usePointer,
} from "./webgpuCommon.jsx"

const NUM_INSTANCES = 4096
const INSTANCE_DATA_SIZE = 16 // 4 floats for position, 4 for rotation, 4 for scale/color info... simplified

export default function CrystalLatticeDemo() {
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
          const shaderModule = device.createShaderModule({
            code: /* wgsl */ `
            struct Uniforms {
              time: f32,
              aspect: f32,
              mx: f32,
              my: f32,
            };

            struct Instance {
              pos: vec3f,
              rot: f32,
              hue: f32,
              scale: f32,
            };

            @group(0) @binding(0) var<uniform> u: Uniforms;
            @group(0) @binding(1) var<storage, read> instances: array<Instance>;

            struct VSOut {
              @builtin(position) pos: vec4f,
              @location(0) color: vec3f,
              @location(1) dist: f32,
            };

            fn rotateY(v: vec3f, a: f32) -> vec3f {
              let s = sin(a); let c = cos(a);
              return vec3f(v.x * c + v.z * s, v.y, v.z * c - v.x * s);
            }

            fn rotateX(v: vec3f, a: f32) -> vec3f {
              let s = sin(a); let c = cos(a);
              return vec3f(v.x, v.y * c - v.z * s, v.z * c + v.y * s);
            }

            @vertex
            fn vsMain(@builtin(vertex_index) vIdx: u32, @builtin(instance_index) iIdx: u32) -> VSOut {
              // Simple crystal octahedron geometry
              var mesh = array<vec3f, 18>(
                vec3f(0,1,0), vec3f(1,0,1), vec3f(-1,0,1),
                vec3f(0,1,0), vec3f(-1,0,1), vec3f(-1,0,-1),
                vec3f(0,1,0), vec3f(-1,0,-1), vec3f(1,0,-1),
                vec3f(0,1,0), vec3f(1,0,-1), vec3f(1,0,1),
                vec3f(0,-1,0), vec3f(-1,0,1), vec3f(1,0,1),
                vec3f(0,-1,0), vec3f(1,0,-1), vec3f(-1,0,-1)
              );

              let inst = instances[iIdx];
              var p = mesh[vIdx % 18u] * 0.08 * inst.scale;
              
              // Rotate instance
              p = rotateY(p, inst.rot + u.time * 0.5);
              p = rotateX(p, inst.rot * 0.7 + u.time * 0.3);
              
              // World position
              var worldPos = inst.pos + p;
              
              // Tilt the whole lattice with mouse
              worldPos = rotateY(worldPos, (u.mx - 0.5) * 1.5);
              worldPos = rotateX(worldPos, (u.my - 0.5) * 1.5);

              var out: VSOut;
              out.pos = vec4f(worldPos.xy, worldPos.z * 0.1, 1.0);
              out.pos.x /= u.aspect;
              
              let hue = fract(inst.hue + u.time * 0.05);
              out.color = 0.5 + 0.5 * cos(6.28318 * (vec3f(0,0.33,0.66) + hue));
              out.dist = worldPos.z;
              
              return out;
            }

            @fragment
            fn fsMain(in: VSOut) -> @location(0) vec4f {
              let glow = 1.0 / (1.0 + in.dist * in.dist * 0.5);
              return vec4f(in.color * (0.4 + 0.6 * glow), 0.8);
            }
          `,
          })

          // --- Buffers ---
          const initialData = new Float32Array(NUM_INSTANCES * 8) // 4 for vec3+padding, 4 for rot,hue,scale,padding
          for (let i = 0; i < NUM_INSTANCES; i++) {
            // Distribute in a spherical cloud
            const r = 0.3 + Math.random() * 0.7
            const phi = Math.acos(2.0 * Math.random() - 1.0)
            const theta = 2.0 * Math.PI * Math.random()

            initialData[i * 8 + 0] = r * Math.sin(phi) * Math.cos(theta)
            initialData[i * 8 + 1] = r * Math.sin(phi) * Math.sin(theta)
            initialData[i * 8 + 2] = r * Math.cos(phi)
            initialData[i * 8 + 3] = 0 // padding

            initialData[i * 8 + 4] = Math.random() * 6.28 // rot
            initialData[i * 8 + 5] = Math.random() // hue
            initialData[i * 8 + 6] = 0.3 + Math.random() * 1.5 // scale
            initialData[i * 8 + 7] = 0 // padding
          }

          const instanceBuffer = device.createBuffer({
            size: initialData.byteLength,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
            mappedAtCreation: true,
          })
          new Float32Array(instanceBuffer.getMappedRange()).set(initialData)
          instanceBuffer.unmap()

          const uniformBuffer = device.createBuffer({
            size: 16,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
          })

          // --- Pipeline ---
          const pipeline = device.createRenderPipeline({
            layout: "auto",
            vertex: {
              module: shaderModule,
              entryPoint: "vsMain",
            },
            fragment: {
              module: shaderModule,
              entryPoint: "fsMain",
              targets: [{
                format,
                blend: {
                  color: { srcFactor: 'src-alpha', dstFactor: 'one', operation: 'add' },
                  alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
                }
              }],
            },
            primitive: { topology: "triangle-list" },
            depthStencil: {
              depthWriteEnabled: false,
              depthCompare: "always",
              format: "depth24plus",
            }
          })

          const bindGroup = device.createBindGroup({
            layout: pipeline.getBindGroupLayout(0),
            entries: [
              { binding: 0, resource: { buffer: uniformBuffer } },
              { binding: 1, resource: { buffer: instanceBuffer } },
            ],
          })

          const depthTexture = device.createTexture({
            size: [canvas.width, canvas.height],
            format: "depth24plus",
            usage: GPUTextureUsage.RENDER_ATTACHMENT,
          })

          const onResize = () => configureCanvasSize(canvas, context, device, format)
          onResize()
          window.addEventListener("resize", onResize)

          stop = startLoop((time) => {
            const ptr = pointerRef.current
            const { width, height } = configureCanvasSize(canvas, context, device, format)

            device.queue.writeBuffer(uniformBuffer, 0, new Float32Array([
              time, width / height, ptr.x, ptr.y
            ]))

            const encoder = device.createCommandEncoder()
            const renderPass = encoder.beginRenderPass({
              colorAttachments: [{
                view: context.getCurrentTexture().createView(),
                clearValue: { r: 0, g: 0, b: 0, a: 1 },
                loadOp: "clear", storeOp: "store",
              }],
              depthStencilAttachment: {
                view: depthTexture.createView(),
                depthClearValue: 1.0,
                depthLoadOp: "clear",
                depthStoreOp: "store",
              }
            })
            renderPass.setPipeline(pipeline)
            renderPass.setBindGroup(0, bindGroup)
            renderPass.draw(18, NUM_INSTANCES)
            renderPass.end()
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
      title="Crystal Lattice"
      hint="3D Instanced rendering of 4,096 crystals. Move mouse to tilt the swarm."
      error={error ?? gpuError}
    >
      <canvas ref={canvasRef} width={1920} height={1080} style={{ width: '100%', height: '100%', display: 'block' }} className="demo-canvas" />
    </DemoShell>
  )
}
