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
import PrismaticCrystalDemo from './PrismaticCrystalDemo.jsx'
import NeuralSynapseDemo from './NeuralSynapseDemo.jsx'
import LiquidChromeDemo from './LiquidChromeDemo.jsx'
import BlackHoleWarpDemo from './BlackHoleWarpDemo.jsx'
import NeuralPulseDemo from './NeuralPulseDemo.jsx'
import DigitalRainDemo from './DigitalRainDemo.jsx'
import GlassCausticsDemo from './GlassCausticsDemo.jsx'
import AuroraFlowDemo from './AuroraFlowDemo.jsx'
import PlasmaVortexDemo from './PlasmaVortexDemo.jsx'
import GlassWavesDemo from './GlassWavesDemo.jsx'
import CosmicSilkDemo from './CosmicSilkDemo.jsx'
import BioGrowthDemo from './BioGrowthDemo.jsx'
import MirrorTunnelDemo from './MirrorTunnelDemo.jsx'
import ElectricCoreDemo from './ElectricCoreDemo.jsx'
import ElectricGridDemo from './ElectricGridDemo.jsx'
import LiquidVortexDemo from './LiquidVortexDemo.jsx'
import NeonTunnelDemo from './NeonTunnelDemo.jsx'
import WarpedKaleidoscopeDemo from './WarpedKaleidoscopeDemo.jsx'
import ElectricNeuralWebDemo from './ElectricNeuralWebDemo.jsx'

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
  { key: 'crystal', label: 'Prismatic Crystal', component: PrismaticCrystalDemo },
  { key: 'synapse', label: 'Neural Synapse', component: NeuralSynapseDemo },
  { key: 'chrome', label: 'Liquid Chrome', component: LiquidChromeDemo },
  { key: 'blackhole', label: 'Black Hole Warp', component: BlackHoleWarpDemo },
  { key: 'pulse', label: 'Neural Pulse', component: NeuralPulseDemo },
  { key: 'digitalrain', label: 'Digital Rain', component: DigitalRainDemo },
  { key: 'glasscaustics', label: 'Glass Caustics', component: GlassCausticsDemo },
  { key: 'auroraflow', label: 'Aurora Flow', component: AuroraFlowDemo },
  { key: 'vortex', label: 'Plasma Vortex', component: PlasmaVortexDemo },
  { key: 'glasswaves', label: 'Glass Waves', component: GlassWavesDemo },
  { key: 'cosmicsilk', label: 'Cosmic Silk', component: CosmicSilkDemo },
  { key: 'biogrowth', label: 'Bio Growth', component: BioGrowthDemo },
  { key: 'mirrortunnel', label: 'Mirror Tunnel', component: MirrorTunnelDemo },
  { key: 'electriccore', label: 'Electric Core', component: ElectricCoreDemo },
  { key: 'electricgrid', label: 'Electric Grid', component: ElectricGridDemo },
  { key: 'liquidvortex', label: 'Liquid Vortex', component: LiquidVortexDemo },
  { key: 'neontunnel', label: 'Neon Tunnel', component: NeonTunnelDemo },
  { key: 'warpedkaleidoscope', label: 'Warped Kaleidoscope', component: WarpedKaleidoscopeDemo },
  { key: 'electricneuralweb', label: 'Electric Neural Web', component: ElectricNeuralWebDemo },
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
        {Array.from({ length: Math.ceil(demos.length / 10) }).map((_, rowIndex) => (
          <div key={rowIndex} className="tabs-row">
            {demos.slice(rowIndex * 10, (rowIndex + 1) * 10).map((d) => (
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
