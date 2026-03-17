import { useMemo, useState } from 'react'
import { WebGPUProvider } from './WebGPUContext.jsx'
import FractalTunnelDemo from './FractalTunnelDemo.jsx'
import GalaxyWarpDemo from './GalaxyWarpDemo.jsx'
import LavaOceanDemo from './LavaOceanDemo.jsx'
import AuroraDemo from './AuroraDemo.jsx'
import NebulaFlowDemo from './NebulaFlowDemo.jsx'
import ParticleSwarmDemo from './ParticleSwarmDemo.jsx'
import NeonGridDemo from './NeonGridDemo.jsx'
// import CrystalLatticeDemo from './CrystalLatticeDemo.jsx'
import QuantumFieldDemo from './QuantumFieldDemo.jsx'
import BioBlobsDemo from './BioBlobsDemo.jsx'
import GlitchGridDemo from './GlitchGridDemo.jsx'
import StarfieldWarpDemo from './StarfieldWarpDemo.jsx'
import CyberCityDemo from './CyberCityDemo.jsx'
import GalaxyWhirlDemo from './GalaxyWhirlDemo.jsx'
import CosmicSingularityDemo from './CosmicSingularityDemo.jsx'
import PrismaticCrystalDemo from './PrismaticCrystalDemo.jsx'
import NeuralSynapseDemo from './NeuralSynapseDemo.jsx'
import LiquidChromeDemo from './LiquidChromeDemo.jsx'

const demos = [
  { key: 'tunnel', label: 'Fractal Tunnel', component: FractalTunnelDemo },
  { key: 'galaxy', label: 'Galaxy Warp', component: GalaxyWarpDemo },
  { key: 'lava', label: 'Lava Ocean', component: LavaOceanDemo },
  { key: 'aurora', label: 'Aurora', component: AuroraDemo },
  { key: 'nebula', label: 'Nebula Flow', component: NebulaFlowDemo },
  { key: 'particles', label: 'Million Particles', component: ParticleSwarmDemo },
  { key: 'neongrid', label: 'Neon Grid', component: NeonGridDemo },
  // { key: 'crystals', label: 'Crystal Lattice', component: CrystalLatticeDemo },
  { key: 'quantum', label: 'Quantum Field', component: QuantumFieldDemo },
  { key: 'blobs', label: 'Bio-Blobs', component: BioBlobsDemo },
  { key: 'glitch', label: 'Glitch Grid', component: GlitchGridDemo },
  { key: 'starfield', label: 'Starfield Warp', component: StarfieldWarpDemo },
  { key: 'cybercity', label: 'Cyber City', component: CyberCityDemo },
  { key: 'whirl', label: 'Galaxy Whirl', component: GalaxyWhirlDemo },
  // { key: 'cosmic', label: 'Cosmic Singularity', component: CosmicSingularityDemo },
  { key: 'crystal', label: 'Prismatic Crystal', component: PrismaticCrystalDemo },
  { key: 'synapse', label: 'Neural Synapse', component: NeuralSynapseDemo },
  { key: 'chrome', label: 'Liquid Chrome', component: LiquidChromeDemo },
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
        <div className="tabs-row">
          {demos.slice(0, 10).map((d) => (
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
        <div className="tabs-row">
          {demos.slice(7).map((d) => (
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
