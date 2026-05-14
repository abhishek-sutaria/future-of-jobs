import React, { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Color, ShaderMaterial, DoubleSide, Vector3, Vector2 } from 'three';
import { useStore } from '../store';
import type { Job } from '../types';
import { getCurrentYearGrowth, getTerrainPosition, getVisualHeightForEmployment, getVisualHeightForWorkersAtYear, TERRAIN_CONFIG } from '../utils/terrainMath';
import { CLUSTER_COLORS, FALLBACK_COLORS } from '../config/theme';
import { YEAR_MIN, YEAR_MAX, YEAR_COUNT, SHADER, SHADER_VISUAL, SHADER_COLORS, SCENE } from '../config/constants';

/** Same interpolation as JobMarkers; avoids non-constant indexing into huge uniform arrays in GLSL (often breaks on WebGL). */
function growthAtYearFromFlatForecasts(forecasts: number[], jobIndex: number, year: number): number {
    const t = Math.max(YEAR_MIN, Math.min(YEAR_MAX, year));
    const y1 = Math.floor(t);
    const y2 = Math.ceil(t);
    const offset1 = y1 - YEAR_MIN;
    const offset2 = y2 - YEAR_MIN;
    const idx1 = jobIndex * YEAR_COUNT + offset1;
    const idx2 = jobIndex * YEAR_COUNT + offset2;
    const val1 = forecasts[idx1] ?? 0;
    const val2 = forecasts[idx2] ?? 0;
    const f = t - y1;
    return val1 * (1 - f) + val2 * f;
}

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
        float declineTint = growthImpact < 0.0 ? min(${SHADER.DECLINE_TINT_MAX.toFixed(2)}, abs(growthImpact) * 0.08) : 0.0;
        vec3 peakColor = mix(uColors[i], vec3(1.0, 0.28, 0.28), declineTint);
        blendedColor += peakColor * colorWeight;
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
  const forecastsRef = useRef<number[]>([]);
  const filteredJobsRef = useRef<Job[]>([]);
  const jobs = useStore((state) => state.jobs);
  const selectedRoleIds = useStore((state) => state.selectedRoleIds);
  const heightMode = useStore((state) => state.heightMode);

  const uniforms = useMemo(() => {
    const filteredJobs = selectedRoleIds.size === 0
      ? jobs
      : jobs.filter(job => selectedRoleIds.has(job.id));

    // uPeaks[i].xy = world position; uPeaks[i].z = baseline workers height (useFrame
    // refreshes .z each frame in Workers mode vs the timeline).
    const peakVectors = new Array(SHADER.MAX_JOBS).fill(0).map((_, i) => {
      if (i >= filteredJobs.length) return new Vector3(0, 0, 0);
      const job = filteredJobs[i];
      const originalIndex = jobs.findIndex(j => j.id === job.id);
      const { x, z } = getTerrainPosition(originalIndex);
      const employmentHeight = getVisualHeightForEmployment(job.employment);
      return new Vector3(x, -z, employmentHeight);
    });

    const colors = new Array(SHADER.MAX_JOBS).fill(0).map((_, i) => {
      if (i >= filteredJobs.length) return new Vector3(0, 0, 0);
      const job = filteredJobs[i];

      let c = new Color(0.13, 0.82, 0.93);
      const hexColor = CLUSTER_COLORS[job.cluster]
        ? parseInt(CLUSTER_COLORS[job.cluster].replace('#', '0x'))
        : parseInt(FALLBACK_COLORS[(jobs.findIndex(j => j.id === job.id)) % FALLBACK_COLORS.length].replace('#', '0x'));
      c.setHex(hexColor);
      return new Vector3(c.r, c.g, c.b);
    });

    const forecasts = new Array(SHADER.FORECAST_ARRAY_SIZE).fill(0);

    filteredJobs.forEach((job, jobIdx) => {
      if (jobIdx >= SHADER.MAX_JOBS) return;

      for (let year = YEAR_MIN; year <= YEAR_MAX; year++) {
        const yearIdx = year - YEAR_MIN;
        const flatIdx = (jobIdx * YEAR_COUNT) + yearIdx;
        const fallbackImpact = getCurrentYearGrowth(job, year).value;

        if (job.yearlyForecast) {
          const item = job.yearlyForecast.find(f => f.year === year);
          forecasts[flatIdx] = item ? item.growthImpact : fallbackImpact;
        } else {
          forecasts[flatIdx] = fallbackImpact;
        }
      }
    });

    forecastsRef.current = forecasts;
    filteredJobsRef.current = filteredJobs;

    const growthNow = new Float32Array(SHADER.MAX_JOBS);
    const yearNow = useStore.getState().year;
    for (let i = 0; i < filteredJobs.length; i++) {
      growthNow[i] = growthAtYearFromFlatForecasts(forecasts, i, yearNow);
    }

    return {
      uTime: { value: 0 },
      uMouse: { value: new Vector2(0, 0) },
      uPeaks: { value: peakVectors },
      uColors: { value: colors },
      uGrowthNow: { value: growthNow },
      uPeakCount: { value: filteredJobs.length },
      uHeightMode: { value: useStore.getState().heightMode === 'employment' ? 1.0 : 0.0 },
    };
  }, [jobs, selectedRoleIds]);

  const meshKey = useMemo(() =>
    (Array.from(selectedRoleIds).sort().join(',') || 'all') + '-' + jobs.length + '-' + jobs.map(j => j.yearlyForecast ? 'Y' : 'N').join('')
    , [selectedRoleIds, jobs]);

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
    if (peakCount === 0 || forecasts.length === 0) return;

    const currentYear = useStore.getState().year;
    const growthArr = mat.uniforms.uGrowthNow.value as Float32Array;
    for (let i = 0; i < peakCount; i++) {
      growthArr[i] = growthAtYearFromFlatForecasts(forecasts, i, currentYear);
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
      key={meshKey}
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
