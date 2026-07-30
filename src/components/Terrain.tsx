import React, { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { ShaderMaterial, DoubleSide, Vector3, Vector2 } from 'three';
import { useStore } from '../store';
import type { Job } from '../types';
import { getTerrainPosition, getVisualHeightForEmployment, getVisualHeightForWorkersAtYear, buildGrowthForecastFlatArray, growthAtYearFromForecastFlat, TERRAIN_CONFIG } from '../utils/terrainMath';
import { riskColorRGB, RISK_UNSCORED_RGB } from '../config/theme';
import { SHADER, SHADER_VISUAL, SHADER_COLORS, SCENE } from '../config/constants';

// SHADERS
const vertexShader = `
  varying vec2 vUv;
  varying float vElevation;
  varying vec3 vColor;
  varying vec3 vPos;

  uniform float uTime;

  // Peak Data
  // uPeaks[i] = vec3(worldX, worldZ, workersModeHeight)
  //   .xy = location in terrain plane
  //   .z  = log-scaled peak height in Workers mode (CPU updates each frame vs timeline)
  uniform vec3 uPeaks[${SHADER.MAX_JOBS}];
  uniform vec3 uColors[${SHADER.MAX_JOBS}];

  // Per-job current-year growth value (cumulative %, from Claude). Mutated by CPU
  // each frame. This is the ONLY dynamically-indexed uniform array — some WebGL
  // drivers don't reliably index more than one.
  uniform float uGrowthNow[${SHADER.MAX_JOBS}];
  uniform int uPeakCount;

  // Scalar mode flag (not an array): 0.0 = Growth mode, 1.0 = Workers mode.
  uniform float uHeightMode;

  const float SIGMA_SQ2 = ${SHADER.SIGMA_SQ2.toFixed(1)};
  const float HEIGHT_SCALE = ${SHADER.HEIGHT_SCALE.toFixed(1)};

  void main() {
    vUv = uv;
    vec3 pos = position;

    vec2 worldPos = (uv - 0.5) * vec2(${SCENE.PLANE_SIZE}.0, ${SCENE.PLANE_SIZE}.0);

    float elevation = 0.0;
    vec3 blendedColor = vec3(0.0);
    float totalWeight = 0.0;

    // Iterate Jobs
    for(int i = 0; i < uPeakCount; i++) {

        vec3 peakData = uPeaks[i];
        float growthImpact = uGrowthNow[i];

        // Workers mode: peak height from uPeaks.z (implied headcount at scrub year, CPU-updated).
        // Growth mode: height from uGrowthNow only.
        float growthScaler = growthImpact >= 0.0 ? ${SHADER.GROWTH_DAMPENING} : ${SHADER.DECLINE_DAMPENING};
        float growthHeight = 1.0 + growthImpact * growthScaler;
        float rawHeight = uHeightMode > 0.5 ? peakData.z : growthHeight;
        float visualHeight = clamp(rawHeight, ${SHADER.HEIGHT_CLAMP_MIN}, ${SHADER.HEIGHT_CLAMP_MAX.toFixed(1)});

        float dx = worldPos.x - peakData.x;
        float dz = worldPos.y - peakData.y; // worldPos.y is Z in terrain space
        
        float distSq = dx*dx + dz*dz;
        
        float influence = visualHeight * exp(-distSq / SIGMA_SQ2);
        elevation += influence;
        
        float colorWeight = exp(-distSq / (SIGMA_SQ2 * 2.0));
        // Color = Job Security Index (uColors); decline is encoded by sinking peaks, not tint
        blendedColor += uColors[i] * colorWeight;
        totalWeight += colorWeight;
    }

    if (totalWeight < 0.001) {
        vColor = ${SHADER_COLORS.TERRAIN_DEFAULT};
    } else {
        vColor = blendedColor / totalWeight;
    }

    vElevation = elevation * HEIGHT_SCALE;
    pos.z += vElevation;
    vPos = pos;

    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  }
`;

const fragmentShader = `
  varying vec2 vUv;
  varying float vElevation;
  varying vec3 vColor;
  varying vec3 vPos;
  
  uniform float uTime; 
  uniform vec2 uMouse;

  void main() {
    vec3 fdx = dFdx(vPos);
    vec3 fdy = dFdy(vPos);
    vec3 normal = normalize(cross(fdx, fdy));
    vec3 viewDir = normalize(cameraPosition - vPos);

    vec3 baseColor = ${SHADER_COLORS.TERRAIN_BASE};

    float gridX = step(${SHADER_VISUAL.GRID_THRESHOLD}, fract(vUv.x * ${SHADER_VISUAL.GRID_FREQUENCY}.0));
    float gridY = step(${SHADER_VISUAL.GRID_THRESHOLD}, fract(vUv.y * ${SHADER_VISUAL.GRID_FREQUENCY}.0));
    float grid = max(gridX, gridY);

    vec3 gridColor = ${SHADER_COLORS.GRID};

    float heightMix = smoothstep(${SHADER_VISUAL.HEIGHT_MIX_MIN}, ${SHADER_VISUAL.HEIGHT_MIX_MAX.toFixed(1)}, vElevation);

    vec3 dataPeakColor = mix(baseColor, vColor, heightMix * 0.8);

    float isoline = step(${SHADER_VISUAL.ISOLINE_THRESHOLD}, fract(vElevation * ${SHADER_VISUAL.ISOLINE_FREQUENCY.toFixed(1)}));
    vec3 isolineColor = mix(${SHADER_COLORS.ISOLINE_DARK}, ${SHADER_COLORS.ISOLINE_BRIGHT}, heightMix);

    float mouseDist = distance(vPos.xz, uMouse);
    float mouseHighlight = smoothstep(${SHADER_VISUAL.MOUSE_HIGHLIGHT_FALLOFF.toFixed(1)}, 0.0, mouseDist);
    vec3 cursorColor = ${SHADER_COLORS.CURSOR} * mouseHighlight * 0.2;

    float fresnel = pow(1.0 - abs(dot(normal, viewDir)), 2.0);
    vec3 rim = ${SHADER_COLORS.RIM_LIGHTING} * fresnel * 0.3;

    vec3 finalColor = dataPeakColor;
    finalColor = mix(finalColor, gridColor, grid * 0.3); 
    finalColor = mix(finalColor, isolineColor, isoline * 0.2); 
    finalColor += rim + cursorColor;

    float dist = distance(vUv, vec2(0.5));
    float alpha = 1.0 - smoothstep(${SHADER_VISUAL.EDGE_FADE_START}, ${SHADER_VISUAL.EDGE_FADE_END}, dist);
    
    gl_FragColor = vec4(finalColor, alpha);
  }
`;

export const Terrain: React.FC = () => {
  const materialRef = useRef<ShaderMaterial>(null);
  const forecastsRef = useRef<Float32Array | null>(null);
  const filteredJobsRef = useRef<Job[]>([]);
  const jobs = useStore((state) => state.jobs);
  const selectedRoleIds = useStore((state) => state.selectedRoleIds);
  const heightMode = useStore((state) => state.heightMode);

  const filteredJobs = useMemo(() => (
    selectedRoleIds.size === 0 ? jobs : jobs.filter(job => selectedRoleIds.has(job.id))
  ), [jobs, selectedRoleIds]);

  // The uniforms OBJECT IDENTITY must never change after first render.
  //
  // three.js captures `materialProperties.uniforms = parameters.uniforms` once, when
  // the shader program is acquired, and every later upload writes from that captured
  // object. If a new uniforms object is assigned to the material afterwards, the
  // renderer keeps uploading the original one, so per-frame writes (uGrowthNow, uTime)
  // silently never reach the GPU and the terrain freezes.
  //
  // This used to be masked: the mesh carried a `key` derived from which jobs had a
  // forecast, so the first AI scoring pass remounted the mesh and re-captured the
  // uniforms. Now that every job ships with a precomputed forecast that key never
  // changes, so nothing ever re-captures — hence a stable object mutated in place.
  const uniforms = useMemo(() => ({
    uTime: { value: 0 },
    uMouse: { value: new Vector2(0, 0) },
    uPeaks: { value: Array.from({ length: SHADER.MAX_JOBS }, () => new Vector3(0, 0, 0)) },
    uColors: { value: Array.from({ length: SHADER.MAX_JOBS }, () => new Vector3(0, 0, 0)) },
    uGrowthNow: { value: new Float32Array(SHADER.MAX_JOBS) },
    uPeakCount: { value: 0 },
    uHeightMode: { value: useStore.getState().heightMode === 'employment' ? 1.0 : 0.0 },
  }), []);

  // Write per-job data into that stable object whenever the job set changes.
  // Runs during render (not in an effect) so the very first frame is already correct.
  useMemo(() => {
    const peaks = uniforms.uPeaks.value;
    const colors = uniforms.uColors.value;

    for (let i = 0; i < SHADER.MAX_JOBS; i++) {
      const job = filteredJobs[i];
      if (!job) {
        peaks[i].set(0, 0, 0);
        colors[i].set(0, 0, 0);
        continue;
      }
      const originalIndex = jobs.findIndex(j => j.id === job.id);
      const { x, z } = getTerrainPosition(originalIndex, jobs);
      // .xy = world position; .z = Workers-mode height (useFrame updates it per year)
      peaks[i].set(x, -z, getVisualHeightForEmployment(job.employment));

      // Peak color encodes the Job Security Index (cyan→amber→red, matches Legend);
      // neutral slate until Claude scoring has produced a real automationCostIndex.
      const unscored = job.automationCostIndex === 0 && job.tasks.every(t => t.aiCapabilityScore === 0);
      const [r, g, b] = unscored ? RISK_UNSCORED_RGB : riskColorRGB(job.automationCostIndex);
      colors[i].set(r, g, b);
    }

    const forecasts = buildGrowthForecastFlatArray(filteredJobs);
    forecastsRef.current = forecasts;
    filteredJobsRef.current = filteredJobs;
    uniforms.uPeakCount.value = filteredJobs.length;

    const yearNow = useStore.getState().year;
    const growthNow = uniforms.uGrowthNow.value;
    for (let i = 0; i < filteredJobs.length; i++) {
      growthNow[i] = growthAtYearFromForecastFlat(forecasts, i, yearNow);
    }

    if (materialRef.current) materialRef.current.uniformsNeedUpdate = true;
  }, [filteredJobs, jobs, uniforms]);

  // Keep uHeightMode in sync with the store toggle without remounting the mesh.
  React.useEffect(() => {
    const mat = materialRef.current;
    if (!mat || !mat.uniforms.uHeightMode) return;
    mat.uniforms.uHeightMode.value = heightMode === 'employment' ? 1.0 : 0.0;
  }, [heightMode]);

  // Push current-year growth values to the GPU every frame. Only ONE
  // dynamically-indexed uniform array (uGrowthNow) — drives both color tint
  // and (via in-shader formula) Growth-mode peak height.
  useFrame((state) => {
    const mat = materialRef.current;
    if (!mat) return;
    mat.uniforms.uTime.value = state.clock.getElapsedTime();

    const forecasts = forecastsRef.current;
    const peakCount = mat.uniforms.uPeakCount.value as number;
    if (peakCount === 0 || !forecasts || forecasts.length === 0) return;

    const currentYear = useStore.getState().year;
    const growthArr = mat.uniforms.uGrowthNow.value as Float32Array;
    for (let i = 0; i < peakCount; i++) {
      growthArr[i] = growthAtYearFromForecastFlat(forecasts, i, currentYear);
    }

    const hm = useStore.getState().heightMode;
    if (hm === 'employment') {
      const peaks = mat.uniforms.uPeaks.value as Vector3[];
      const fj = filteredJobsRef.current;
      for (let i = 0; i < peakCount; i++) {
        const job = fj[i];
        if (!job) continue;
        peaks[i].z = getVisualHeightForWorkersAtYear(job.employment, growthArr[i]);
      }
    }

    // ShaderMaterial only re-uploads uniforms when this flag is true (see three.js
    // WebGLRenderer). In-place Float32Array writes do not flip it — without this,
    // uGrowthNow / uTime never reach the GPU after the first upload.
    mat.uniformsNeedUpdate = true;
  });

  return (
    <mesh
      rotation={[-Math.PI / 2, 0, 0]}
      position={[0, TERRAIN_CONFIG.TERRAIN_OFFSET_Y, 0]}
      onPointerMove={(e) => {
        if (materialRef.current && e.uv) {
          const x = (e.uv.x - 0.5) * SCENE.PLANE_SIZE;
          const y = (e.uv.y - 0.5) * SCENE.PLANE_SIZE;
          materialRef.current.uniforms.uMouse.value.set(x, y);
        }
      }}
    >
      <planeGeometry args={[SCENE.PLANE_SIZE, SCENE.PLANE_SIZE, 192, 192]} />
      <shaderMaterial
        ref={materialRef}
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        uniforms={uniforms}
        wireframe={false}
        transparent={true}
        side={DoubleSide}
      />
    </mesh>
  );
};
