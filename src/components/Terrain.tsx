import React, { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Color, ShaderMaterial, DoubleSide, Vector3 } from 'three';
import { useStore } from '../store';
import { getTerrainPosition, TERRAIN_CONFIG } from '../utils/terrainMath';

// SHADERS
const vertexShader = `
  varying vec2 vUv;
  varying float vElevation;
  varying vec3 vColor;

  uniform float uTime;
  
  // Peak Data (Flat Arrays for robustness)
  // uniform vec3 uPeaks[20] => ThreeJS maps array of Vector3 to this.
  uniform vec3 uPeaks[50]; 
  uniform vec3 uColors[50]; 
  uniform int uPeakCount;

  // Constants 
  const float SIGMA_SQ2 = 12.5; // Adjusted for Sigma 2.5 (2 * 2.5^2)
  const float HEIGHT_SCALE = 2.5; // Matches terrainMath.ts

  void main() {
    vUv = uv;
    vec3 pos = position; 
    
    // UV (0..1) -> World Coordinates
    // Plane is 70x70 (Expanded)
    // We want 0,0 to be center
    vec2 worldPos = (uv - 0.5) * vec2(70.0, 70.0);
    
    // Calculate Height (Sum of Gaussians)
    float elevation = 0.0;
    vec3 blendedColor = vec3(0.0);
    float totalWeight = 0.0;

    for(int i = 0; i < 50; i++) {
        if (i >= uPeakCount) break;
        
        vec3 peak = uPeaks[i]; // x, z, height
        vec3 color = uColors[i];

        // INVERTING Z logic to match World Space (Mesh Rotated -90deg X)
        // worldPos.y corresponds to Terrain Plane's 'height' relative to camera, which is Z
        // peak.y in the uniform now holds the -z value we passed
        float dz = worldPos.y - peak.y; 
        
        float distSq = dx*dx + dz*dz;
        
        // Gaussian Height
        float influence = peak.z * exp(-distSq / SIGMA_SQ2);
        elevation += influence;
        
        // Color Blending (Looser falloff for smoother gradients)
        float colorWeight = exp(-distSq / (SIGMA_SQ2 * 2.0)); 
        blendedColor += color * colorWeight;
        totalWeight += colorWeight;
    }

    // Default Grid Color (Deep Blue) vs Blended Peak Color
    if (totalWeight < 0.001) {
        vColor = vec3(0.05, 0.1, 0.2); 
    } else {
        vColor = blendedColor / totalWeight;
    }

    vElevation = elevation * HEIGHT_SCALE;

    // Displace Z (which is World Y)
    pos.z += vElevation;

    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  }
`;

const fragmentShader = `
  varying vec2 vUv;
  varying float vElevation;
  varying vec3 vColor;

  void main() {
    // Basic Wireframe Color
    // Mix with elevation brightness
    float brightness = 0.6 + (vElevation * 0.15); 
    vec3 finalColor = vColor * brightness;
    
    // Make wireframe lines glow
    finalColor += vec3(0.1, 0.1, 0.3) * brightness;

    // Vignette / Soft Edges
    // Calculate distance from center (UV 0.5, 0.5)
    float dist = distance(vUv, vec2(0.5));
    // Smoothstep to fade out towards edges (0.4 to 0.5 radius)
    // Relaxed fade start even more (0.45) to ensure visibility
    float alpha = 1.0 - smoothstep(0.45, 0.5, dist);

    gl_FragColor = vec4(finalColor, 0.8 * alpha);
  }
`;

export const Terrain: React.FC = () => {
  const materialRef = useRef<ShaderMaterial>(null);
  const jobs = useStore((state) => state.jobs);
  // OPTIMIZATION: Do NOT subscribe to state.year here.
  // Access it imperatively in useFrame to prevent Re-Renders of the entire Mesh.

  // Initialize Uniforms with Vector3 arrays
  // Three.js handles array of Vector3s natively if initialized correctly
  const uniforms = useMemo(() => {
    return {
      uTime: { value: 0 },
      uPeaks: { value: new Array(50).fill(0).map(() => new Vector3(0, 0, 0)) },
      uColors: { value: new Array(50).fill(0).map(() => new Vector3(0, 0, 0)) },
      uPeakCount: { value: jobs.length }
    };
  }, []);

  useFrame((state) => {
    if (!materialRef.current) return;

    // Access year directly from store for animation
    const year = useStore.getState().year;

    materialRef.current.uniforms.uTime.value = state.clock.getElapsedTime();

    // Update Arrays
    jobs.forEach((job, i) => {
      if (i >= 50) return;

      // ANIMATION LOGIC
      // Interpolate growth impact based on current year (2025-2030)
      const progress = (year - 2025) / 5; // 0.0 to 1.0

      // Calculate "Current" Growth at this specific year
      const currentGrowth = job.projectedGrowth * progress;

      // 1. Visual Height Calculation
      // Base height (1.0) + Growth Impact.
      const getVisualHeight = (growthDelta: number) => {
        const dampened = 1.0 + (growthDelta * 0.08); // 25 * 0.08 = +2.0 -> Total 3.0
        return Math.max(0.2, Math.min(4.0, dampened)); // Clamp between 0.2 and 4.0
      };

      const h = getVisualHeight(currentGrowth);

      // Position
      const { x, z } = getTerrainPosition(i);

      // 2. Color Grading (New Logic)
      let c = new Color(0.2, 0.4, 0.6); // Default Blue-ish

      if (job.projectedGrowth > 15) {
        c.setHex(0xFFD700); // Gold for "Booming"
      } else if (job.projectedGrowth > 5) {
        c.setHex(0x10B981); // Emerald Green for "Strong Growth"
      } else if (job.projectedGrowth < 0) {
        c.setHex(0xEF4444); // Red for "Decline"
      } else {
        c.setHex(0x3B82F6); // Standard Blue
      }

      // Directly modify the Vector3 objects in the uniform array
      const peakVec = materialRef.current!.uniforms.uPeaks.value[i];
      // FIXED: Invert Z because Mesh is rotated -90deg X (World Z = Local -Y)
      if (peakVec) peakVec.set(x, -z, h);

      const colorVec = materialRef.current!.uniforms.uColors.value[i];
      if (colorVec) colorVec.set(c.r, c.g, c.b);
    });

    // FIXED: Force Three.js to detect the array change for Uniforms
    // Without this, modifying inner properties of Vector3 isn't always picked up
    materialRef.current.uniforms.uPeaks.value = [...materialRef.current.uniforms.uPeaks.value];
    materialRef.current.uniforms.uColors.value = [...materialRef.current.uniforms.uColors.value];

    materialRef.current.uniforms.uPeakCount.value = Math.min(jobs.length, 50);
  });

  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, TERRAIN_CONFIG.TERRAIN_OFFSET_Y, 0]}>
      {/* Plane centered at 0, Offset Y to allow peaks to rise up */}
      {/* Medium Grid: 64x64 segments */}
      <planeGeometry args={[70, 70, 64, 64]} />
      <shaderMaterial
        ref={materialRef}
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        uniforms={uniforms}
        wireframe={true}
        transparent={true}
        side={DoubleSide}
      />
    </mesh>
  );
};
