import { useEffect, useRef, useState } from "react"
import { useWebGPU } from "./WebGPUContext.jsx"
import {
  DemoShell,
  configureCanvasSize,
  startLoop,
  usePointer,
} from "./webgpuCommon.jsx"

export default function QuantumFieldDemo() {
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

          const TEX_SIZE = 512

          // --- Shaders ---
          const computeModule = device.createShaderModule({
            code: /* wgsl */ `
            @group(0) @binding(0) var tIn: texture_2d<f32>;
            @group(0) @binding(1) var tOut: texture_storage_2d<rgba16float, write>;
            struct Params {
              time: f32,
              mx: f32,
              my: f32,
              down: f32,
            };
            @group(0) @binding(2) var<uniform> p: Params;

            @compute @workgroup_size(16, 16)
            fn main(@builtin(global_invocation_id) id: vec3u) {
              let size = textureDimensions(tIn).xy;
              if (id.x >= size.x || id.y >= size.y) { return; }

              let uv = vec2f(id.xy) / vec2f(size);
              let m = vec2f(p.mx, p.my);
              
              // Standard Ripple Algorithm:
              // next = (avg_neighbors * 2 - previous) * damping
              
              let current = textureLoad(tIn, vec2i(id.xy), 0).r;
              let previous = textureLoad(tIn, vec2i(id.xy), 0).g;
              
              var avg = 0.0;
              // 4-neighbor average is more stable for this algorithm
              let offsets = array<vec2i, 4>(vec2i(1,0), vec2i(-1,0), vec2i(0,1), vec2i(0,-1));
              for(var i=0; i<4; i++) {
                let coord = (vec2i(id.xy) + offsets[i] + vec2i(size)) % vec2i(size);
                avg += textureLoad(tIn, coord, 0).r;
              }
              avg /= 4.0;

              // Mouse influence
              let d = distance(uv, m);
              let force = exp(-d * 60.0) * p.down * 0.5;
              
              var next = (avg * 2.0 - previous) + force;
              next *= 0.98; // Damping

              // Clamp to prevent blowout
              next = clamp(next, -2.0, 2.0);

              // Store current value in Red, and old current value in Green for next frame
              textureStore(tOut, id.xy, vec4f(next, current, 0.0, 1.0));
            }
          `,
          })

          const renderModule = device.createShaderModule({
            code: /* wgsl */ `
            struct VOut {
              @builtin(position) pos: vec4f,
              @location(0) uv: vec2f,
            };

            @vertex
            fn vsMain(@builtin(vertex_index) i: u32) -> VOut {
              var p = array<vec2f, 6>(
                vec2f(-1,-1), vec2f(1,-1), vec2f(-1,1),
                vec2f(-1,1), vec2f(1,-1), vec2f(1,1)
              );
              var out: VOut;
              out.pos = vec4f(p[i], 0.0, 1.0);
              out.uv = p[i] * 0.5 + 0.5;
              out.uv.y = 1.0 - out.uv.y;
              return out;
            }

            @group(0) @binding(0) var t: texture_2d<f32>;
            @group(0) @binding(1) var s: sampler;

            fn palette(t: f32) -> vec3f {
              let a = vec3f(0.5, 0.5, 0.5);
              let b = vec3f(0.5, 0.5, 0.5);
              let c = vec3f(1.0, 1.0, 1.0);
              let d = vec3f(0.00, 0.1, 0.2);
              return a + b * cos(6.28318 * (c * t + d));
            }

            @fragment
            fn fsMain(in: VOut) -> @location(0) vec4f {
              let val = textureSample(t, s, in.uv).r;
              let col = palette(val * 2.0 + 0.5) * (abs(val) * 2.0 + 0.05);
              // Avoid over-bright pixels
              return vec4f(clamp(col, vec3f(0.0), vec3f(1.5)), 1.0);
            }
          `,
          })

          // --- Textures ---
          const textureDesc = {
            size: [TEX_SIZE, TEX_SIZE],
            format: "rgba16float",
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_DST,
          }
          const texA = device.createTexture(textureDesc)
          const texB = device.createTexture(textureDesc)

          // Explicitly clear textures to 0
          const zeroData = new Float32Array(TEX_SIZE * TEX_SIZE * 4).fill(0)
          device.queue.writeTexture({ texture: texA }, zeroData, { bytesPerRow: TEX_SIZE * 16 }, [TEX_SIZE, TEX_SIZE])
          device.queue.writeTexture({ texture: texB }, zeroData, { bytesPerRow: TEX_SIZE * 16 }, [TEX_SIZE, TEX_SIZE])

          const uniformBuffer = device.createBuffer({
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
              targets: [{ format }],
            },
            primitive: { topology: "triangle-list" },
          })

          // --- Bind Groups ---
          const computeBG_A = device.createBindGroup({
            layout: computePipeline.getBindGroupLayout(0),
            entries: [
              { binding: 0, resource: texA.createView() },
              { binding: 1, resource: texB.createView() },
              { binding: 2, resource: { buffer: uniformBuffer } },
            ],
          })
          const computeBG_B = device.createBindGroup({
            layout: computePipeline.getBindGroupLayout(0),
            entries: [
              { binding: 0, resource: texB.createView() },
              { binding: 1, resource: texA.createView() },
              { binding: 2, resource: { buffer: uniformBuffer } },
            ],
          })

          const renderBG_A = device.createBindGroup({
            layout: renderPipeline.getBindGroupLayout(0),
            entries: [
              { binding: 0, resource: texB.createView() },
              { binding: 1, resource: device.createSampler() },
            ],
          })
          const renderBG_B = device.createBindGroup({
            layout: renderPipeline.getBindGroupLayout(0),
            entries: [
              { binding: 0, resource: texA.createView() },
              { binding: 1, resource: device.createSampler() },
            ],
          })

          let step = 0
          const onResize = () => configureCanvasSize(canvas, context, device, format)
          onResize()
          window.addEventListener("resize", onResize)

          stop = startLoop((time) => {
            const ptr = pointerRef.current
            const { width, height } = configureCanvasSize(canvas, context, device, format)

            device.queue.writeBuffer(uniformBuffer, 0, new Float32Array([
              time, ptr.x, ptr.y, ptr.down ? 1 : 0
            ]))

            const encoder = device.createCommandEncoder()

            // Compute Step
            const cPass = encoder.beginComputePass()
            cPass.setPipeline(computePipeline)
            cPass.setBindGroup(0, step % 2 === 0 ? computeBG_A : computeBG_B)
            cPass.dispatchWorkgroups(TEX_SIZE / 16, TEX_SIZE / 16)
            cPass.end()

            // Render Step
            const rPass = encoder.beginRenderPass({
              colorAttachments: [{
                view: context.getCurrentTexture().createView(),
                clearValue: { r: 0, g: 0, b: 0, a: 1 },
                loadOp: "clear", storeOp: "store",
              }],
            })
            rPass.setPipeline(renderPipeline)
            rPass.setBindGroup(0, step % 2 === 0 ? renderBG_A : renderBG_B)
            rPass.draw(6)
            rPass.end()

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
      try { context?.unconfigure() } catch (_) { }
    }
  }, [gpuState, pointerRef])

  return (
    <DemoShell
      title="Quantum Field"
      hint="Compute-based wave simulation on a 512x512 grid. Hover or click to disturb the field."
      error={error ?? gpuError}
    >
      <canvas ref={canvasRef} width={512} height={512} style={{ width: '100%', height: '100%', display: 'block' }} className="demo-canvas" />
    </DemoShell>
  )
}
