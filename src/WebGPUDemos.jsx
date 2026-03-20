import { useMemo, useState } from 'react'
import { WebGPUProvider } from './WebGPUContext.jsx'
import { FPSStats } from './webgpuCommon.jsx'
import FractalTunnelDemo from './FractalTunnelDemo.jsx'
import GalaxyWarpDemo from './GalaxyWarpDemo.jsx'
import LavaOceanDemo from './LavaOceanDemo.jsx'
import AuroraDemo from './AuroraDemo.jsx'
import NebulaFlowDemo from './NebulaFlowDemo.jsx'
import ParticleSwarmDemo from './ParticleSwarmDemo.jsx'
import NeonGridDemo from './NeonGridDemo.jsx'
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
import DimensionalRiftDemo from './DimensionalRiftDemo.jsx'
import LiquidGoldDemo from './LiquidGoldDemo.jsx'
import AethericRibbonsDemo from './AethericRibbonsDemo.jsx'
import CyberMatrixDemo from './CyberMatrixDemo.jsx'
import MoltenPrismDemo from './MoltenPrismDemo.jsx'
import StellarNurseryDemo from './StellarNurseryDemo.jsx'
import TechnoGrowthDemo from './TechnoGrowthDemo.jsx'
import ShatteredDimensionDemo from './ShatteredDimensionDemo.jsx'
import SolarFlareDemo from './SolarFlareDemo.jsx'
import QuantumWeaverDemo from './QuantumWeaverDemo.jsx'
import HolographicTopographyDemo from './HolographicTopographyDemo.jsx'
import TimeWarpTunnelDemo from './TimeWarpTunnelDemo.jsx'
import SynthwaveSunDemo from './SynthwaveSunDemo.jsx'
import FractalIslandsDemo from './FractalIslandsDemo.jsx'
import GoldenSpiralDemo from './GoldenSpiralDemo.jsx'
import RainbowVortexDemo from './RainbowVortexDemo.jsx'
import ChromaticFluidDemo from './ChromaticFluidDemo.jsx'
import PsychedelicWavesDemo from './PsychedelicWavesDemo.jsx'
import CyberHeartDemo from './CyberHeartDemo.jsx'
import LiquidGeometryDemo from './LiquidGeometryDemo.jsx'
import LiquidPlasmaFlowDemo from './LiquidPlasmaFlowDemo.jsx'
import LiquidCrystalBlobsDemo from './LiquidCrystalBlobsDemo.jsx'
import BioluminescentOrbsDemo from './BioluminescentOrbsDemo.jsx'
import NeonDataStreamDemo from './NeonDataStreamDemo.jsx'

const demos = [
  { key: 'tunnel', label: 'Fractal Tunnel', component: FractalTunnelDemo },
  { key: 'galaxy', label: 'Galaxy Warp', component: GalaxyWarpDemo },
  { key: 'lava', label: 'Lava Ocean', component: LavaOceanDemo },
  { key: 'aurora', label: 'Aurora', component: AuroraDemo },
  { key: 'nebula', label: 'Nebula Flow', component: NebulaFlowDemo },
  { key: 'particles', label: 'Million Particles', component: ParticleSwarmDemo },
  { key: 'neongrid', label: 'Neon Grid', component: NeonGridDemo },
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
  { key: 'rift', label: 'Dimensional Rift', component: DimensionalRiftDemo },
  { key: 'gold', label: 'Liquid Gold', component: LiquidGoldDemo },
  { key: 'aetheric', label: 'Aetheric Ribbons', component: AethericRibbonsDemo },
  { key: 'cybermatrix', label: 'Cyber Matrix', component: CyberMatrixDemo },
  { key: 'prism', label: 'Molten Prism', component: MoltenPrismDemo },
  { key: 'nursery', label: 'Stellar Nursery', component: StellarNurseryDemo },
  { key: 'growth', label: 'Techno Growth', component: TechnoGrowthDemo },
  { key: 'shattered', label: 'Shattered Dimension', component: ShatteredDimensionDemo },
  { key: 'solarflare', label: 'Solar Flare', component: SolarFlareDemo },
  { key: 'quantumweaver', label: 'Quantum Weaver', component: QuantumWeaverDemo },
  { key: 'topography', label: 'Holo Topography', component: HolographicTopographyDemo },
  { key: 'timewarp', label: 'Time Warp Tunnel', component: TimeWarpTunnelDemo },
  { key: 'synthwave', label: 'Synthwave Sun', component: SynthwaveSunDemo },
  { key: 'fractalislands', label: 'Fractal Islands', component: FractalIslandsDemo },
  { key: 'goldenspiral', label: 'Golden Spiral', component: GoldenSpiralDemo },
  { key: 'rainbowvortex', label: 'Rainbow Vortex', component: RainbowVortexDemo },
  { key: 'chromaticfluid', label: 'Chromatic Fluid', component: ChromaticFluidDemo },
  { key: 'psychedelicwaves', label: 'Psychedelic Waves', component: PsychedelicWavesDemo },
  { key: 'cyberheart', label: 'Cyber Heart', component: CyberHeartDemo },
  { key: 'liquidgeometry', label: 'Liquid Geometry', component: LiquidGeometryDemo },
  { key: 'plasmaflow', label: 'Liquid Plasma Flow', component: LiquidPlasmaFlowDemo },
  { key: 'crystalblobs', label: 'Liquid Crystal Blobs', component: LiquidCrystalBlobsDemo },
  { key: 'bioorbs', label: 'Bioluminescent Orbs', component: BioluminescentOrbsDemo },
  { key: 'neondatastream', label: 'Neon Data Stream', component: NeonDataStreamDemo },
]
function DemoSelector() {
  const [activeKey, setActiveKey] = useState('tunnel')
  const Active = useMemo(
    () => demos.find((d) => d.key === activeKey)?.component ?? FractalTunnelDemo,
    [activeKey],
  )

  return (
    <main id="center" style={{ position: 'relative', width: '100vw', height: '100vh', overflow: 'hidden', paddingTop: '0', boxSizing: 'border-box' }}>

      {/* Top Floating Menu */}
      <div style={{
        position: 'absolute',
        top: '20px',
        left: '50%',
        transform: 'translateX(-50%)',
        width: '80vw',
        height: '60px',
        zIndex: 2000,
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        background: 'rgba(0, 0, 0, 0.35)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        borderRadius: '30px',
        overflow: 'hidden',
        boxShadow: '0 10px 40px rgba(0, 0, 0, 0.6)',
        transition: 'all 0.3s ease'
      }}>
        <div style={{
          padding: '0 24px',
          color: 'rgba(255,255,255,0.8)',
          letterSpacing: '2px',
          fontFamily: 'monospace',
          fontSize: '13px',
          fontWeight: 'bold',
          borderRight: '1px solid rgba(255,255,255,0.1)',
          whiteSpace: 'nowrap'
        }}>
          {demos.findIndex(d => d.key === activeKey) + 1} / {demos.length}
        </div>

        <div className="top-menu-scroll" style={{
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          gap: '8px',
          padding: '0 16px',
          overflowX: 'auto',
          height: '100%',
          flex: 1
        }}>
          {demos.map((d) => {
            const isActive = d.key === activeKey;
            return (
              <button
                key={d.key}
                onClick={() => setActiveKey(d.key)}
                style={{
                  background: isActive ? 'rgba(74, 222, 128, 0.2)' : 'transparent',
                  border: isActive ? '1px solid rgba(74, 222, 128, 0.5)' : '1px solid transparent',
                  color: isActive ? '#4ade80' : 'rgba(255, 255, 255, 1)',
                  padding: '8px 16px',
                  borderRadius: '20px',
                  fontSize: '14px',
                  fontWeight: '600',
                  textShadow: '0 2px 4px rgba(0,0,0,0.8)',
                  whiteSpace: 'nowrap',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px'
                }}
                onMouseEnter={e => {
                  if (!isActive) {
                    e.currentTarget.style.background = 'rgba(255,255,255,0.05)';
                    e.currentTarget.style.color = '#fff';
                  }
                }}
                onMouseLeave={e => {
                  if (!isActive) {
                    e.currentTarget.style.background = 'transparent';
                    e.currentTarget.style.color = 'rgba(255, 255, 255, 0.95)';
                  }
                }}
              >
                {isActive && <span style={{ fontSize: '10px' }}>●</span>}
                {d.label}
              </button>
            )
          })}
        </div>
        <FPSStats />
      </div>

      <style>{`
        .top-menu-scroll::-webkit-scrollbar {
          height: 4px;
        }
        .top-menu-scroll::-webkit-scrollbar-track {
          background: transparent;
          margin: 20px;
        }
        .top-menu-scroll::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.2);
          border-radius: 10px;
        }
        .top-menu-scroll::-webkit-scrollbar-thumb:hover {
          background: rgba(255, 255, 255, 0.3);
        }
      `}</style>

      {/* Demo Canvas Underlying */}
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
