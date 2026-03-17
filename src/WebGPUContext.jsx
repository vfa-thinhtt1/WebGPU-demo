/**
 * Singleton WebGPU device context.
 *
 * One GPUDevice is created once for the whole app (in <WebGPUProvider>).
 * Individual demos consume it via useWebGPU() and configure their own canvas
 * context on top of the shared device — so tab-switching never destroys /
 * recreates the device, eliminating the GPU-process crash.
 */
import { createContext, useContext, useEffect, useState } from 'react'
import { initWebGPU } from './webgpuUtils.js'

const WebGPUCtx = createContext(null)

export function WebGPUProvider({ children }) {
  const [gpuState, setGpuState] = useState(null) // { device, adapter, format } | null
  const [error, setError]       = useState(null)

  useEffect(() => {
    let device = null
    ;(async () => {
      try {
        if (!navigator.gpu) throw new Error('WebGPU not supported.')
        const adapter = await navigator.gpu.requestAdapter()
        if (!adapter) throw new Error('No GPU adapter found.')
        device = await adapter.requestDevice()
        const format = navigator.gpu.getPreferredCanvasFormat()

        device.lost.then((info) => {
          console.warn('GPUDevice lost:', info.message)
          setGpuState(null)
          setError(`GPU device was lost: ${info.message}`)
        })

        setGpuState({ device, adapter, format })
      } catch (e) {
        setError(e?.message ?? String(e))
      }
    })()

    return () => {
      // Device is intentionally kept alive — the Provider lives for the whole
      // page lifetime. Destroying here would cause issues on StrictMode double-
      // invoke; simply let the browser reclaim on page unload.
    }
  }, [])

  return (
    <WebGPUCtx.Provider value={{ gpuState, error }}>
      {children}
    </WebGPUCtx.Provider>
  )
}

/** Returns { device, format } or { device: null, format: null, error }. */
export function useWebGPU() {
  const ctx = useContext(WebGPUCtx)
  if (!ctx) throw new Error('useWebGPU must be used inside <WebGPUProvider>')
  return ctx
}
