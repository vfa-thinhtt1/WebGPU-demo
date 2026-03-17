export async function initWebGPU(canvas) {
  if (!navigator.gpu) {
    throw new Error('WebGPU is not supported in this browser.')
  }

  const adapter = await navigator.gpu.requestAdapter()
  if (!adapter) {
    throw new Error('Failed to get GPU adapter.')
  }

  const device = await adapter.requestDevice()
  const context = canvas.getContext('webgpu')
  const format = navigator.gpu.getPreferredCanvasFormat()

  context.configure({
    device,
    format,
    alphaMode: 'premultiplied',
  })

  return { device, context, format }
}

export function configureCanvasSize(canvas, context, device, format) {
  const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1))
  const cssWidth = canvas.clientWidth || canvas.width
  const cssHeight = canvas.clientHeight || canvas.height

  const width = Math.max(1, Math.floor(cssWidth * dpr))
  const height = Math.max(1, Math.floor(cssHeight * dpr))

  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width
    canvas.height = height
  }

  context.configure({
    device,
    format,
    alphaMode: 'premultiplied',
  })

  return { width, height, dpr }
}

export function createFullscreenTriangle(device) {
  const vertices = new Float32Array([
    -1, -1, 1, -1, -1, 1,
    -1, 1, 1, -1, 1, 1,
  ])

  const vertexBuffer = device.createBuffer({
    size: vertices.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    mappedAtCreation: true,
  })

  new Float32Array(vertexBuffer.getMappedRange()).set(vertices)
  vertexBuffer.unmap()

  return { vertexBuffer, vertexCount: 6 }
}

export function clamp01(x) {
  return Math.min(1, Math.max(0, x))
}


