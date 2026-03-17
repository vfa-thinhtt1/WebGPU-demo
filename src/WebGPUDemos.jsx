import { useMemo, useState } from 'react'
import { WebGPUProvider } from './WebGPUContext.jsx'
import FractalTunnelDemo from './FractalTunnelDemo.jsx'
import GalaxyWarpDemo from './GalaxyWarpDemo.jsx'
import LavaOceanDemo from './LavaOceanDemo.jsx'
import AuroraDemo from './AuroraDemo.jsx'
import NebulaFlowDemo from './NebulaFlowDemo.jsx'
import ParticleSwarmDemo from './ParticleSwarmDemo.jsx'

const demos = [
  { key: 'tunnel', label: 'Fractal Tunnel', component: FractalTunnelDemo },
  { key: 'galaxy', label: 'Galaxy Warp', component: GalaxyWarpDemo },
  { key: 'lava', label: 'Lava Ocean', component: LavaOceanDemo },
  { key: 'aurora', label: 'Aurora', component: AuroraDemo },
  { key: 'nebula', label: 'Nebula Flow', component: NebulaFlowDemo },
  { key: 'particles', label: 'Million Particles', component: ParticleSwarmDemo },
]

function DemoSelector() {
  const [activeKey, setActiveKey] = useState('tunnel')
  const Active = useMemo(
    () => demos.find((d) => d.key === activeKey)?.component ?? FractalTunnelDemo,
    [activeKey],
  )

  const supported = typeof navigator !== 'undefined' && 'gpu' in navigator

  return (
    <main id="center">
      <div className="demo-tabs">
        {demos.map((d) => (
          <button
            key={d.key}
            className={d.key === activeKey ? 'tab active' : 'tab'}
            type="button"
            onClick={() => setActiveKey(d.key)}
          >
            {d.label}
          </button>
        ))}
      </div>

      <Active />
    </main>
  )
}

export default function WebGPUDemos() {
  return (
    <WebGPUProvider>
      <DemoSelector />
    </WebGPUProvider>
  )
}
