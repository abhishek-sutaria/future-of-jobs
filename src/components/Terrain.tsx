import React, { useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Color, ShaderMaterial, DoubleSide, Vector3, Vector2 } from 'three';
import { useStore } from '../store';
import { getCurrentYearGrowth, getTerrainPosition, TERRAIN_CONFIG } from '../utils/terrainMath';
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
  uniform vec3 uPeaks[${SHADER.MAX_JOBS}];
  uniform vec3 uColors[${SHADER.MAX_JOBS}];

  // Per-job growth impact at the current timeline (uploaded from CPU each frame).
  uniform float uGrowthNow[${SHADER.MAX_JOBS}];
  uniform int uPeakCount;

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
        
        // --- DYNAMIC HEIGHT CALCULATION ---
        float growthImpact = uGrowthNow[i];
        
        float scaler = growthImpact >= 0.0 ? ${SHADER.GROWTH_DAMPENING} : ${SHADER.DECLINE_DAMPENING};
        float dampened = 1.0 + (growthImpact * scaler);
        float visualHeight = clamp(dampened, ${SHADER.HEIGHT_CLAMP_MIN}, ${SHADER.HEIGHT_CLAMP_MAX.toFixed(1)});
        
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
  const lastFrameLogRef = useRef('');
  const jobs = useStore((state) => state.jobs);
  const selectedRoleIds = useStore((state) => state.selectedRoleIds);
  const year = useStore((state) => state.year);

  const uniforms = useMemo(() => {
    const filteredJobs = selectedRoleIds.size === 0
      ? jobs
      : jobs.filter(job => selectedRoleIds.has(job.id));
    const buildYear = useStore.getState().year;
    const { isScoring, hasAIScores, startupAnalysisState } = useStore.getState();

    const peakVectors = new Array(SHADER.MAX_JOBS).fill(0).map((_, i) => {
      if (i >= filteredJobs.length) return new Vector3(0, 0, 0);
      const job = filteredJobs[i];
      const originalIndex = jobs.findIndex(j => j.id === job.id);
      const { x, z } = getTerrainPosition(originalIndex);
      return new Vector3(x, -z, 1.0);
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
          // Use Specific AI Prediction
          const item = job.yearlyForecast.find(f => f.year === year);
          forecasts[flatIdx] = item ? item.growthImpact : fallbackImpact;
        } else {
          // Use risk-aware fallback so overview peaks can visibly decline.
          forecasts[flatIdx] = fallbackImpact;
        }
      }
    });

    forecastsRef.current = forecasts;

      const growthNow = new Float32Array(SHADER.MAX_JOBS);
    const yearNow = useStore.getState().year;
    for (let i = 0; i < filteredJobs.length; i++) {
      growthNow[i] = growthAtYearFromFlatForecasts(forecasts, i, yearNow);
    }

    // #region agent log
    fetch('http://127.0.0.1:7252/ingest/46718283-b9ba-4afd-b6a8-059ca781fa06',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'9fe126'},body:JSON.stringify({sessionId:'9fe126',runId:'run3',hypothesisId:'H7',location:'Terrain.tsx:207',message:'terrain_uniforms_built',data:{buildYear,yearNow,jobCount:filteredJobs.length,jobsWithForecast:filteredJobs.filter(job => !!job.yearlyForecast).length,isScoring,hasAIScores,startupAnalysisState,sampleJobs:filteredJobs.slice(0,3).map((job,i)=>({id:job.id,title:job.title,growthNow:growthNow[i],automationCostIndex:job.automationCostIndex,hasForecast:!!job.yearlyForecast}))},timestamp:Date.now()})}).catch(()=>{});
    // #endregion

    return {
      uTime: { value: 0 },
      uMouse: { value: new Vector2(0, 0) },
      uPeaks: { value: peakVectors },
      uColors: { value: colors },
      uGrowthNow: { value: growthNow },
      uPeakCount: { value: filteredJobs.length }
    };
  }, [jobs, selectedRoleIds]);

  const meshKey = useMemo(() =>
    (Array.from(selectedRoleIds).sort().join(',') || 'all') + '-' + jobs.length + '-' + jobs.map(j => j.yearlyForecast ? 'Y' : 'N').join('')
    , [selectedRoleIds, jobs]);

  // Drive heights from React when the timeline changes so uniforms reliably upload (in-place Float32Array
  // mutation + useFrame-only updates can fail to refresh the GPU on some Three / R3F paths).
  useLayoutEffect(() => {
    const mat = materialRef.current;
    if (!mat) return;
    const forecasts = forecastsRef.current;
    const peakCount = mat.uniforms.uPeakCount.value as number;
    if (peakCount === 0 || forecasts.length === 0) return;

    const next = new Float32Array(SHADER.MAX_JOBS);
    for (let i = 0; i < peakCount; i++) {
      next[i] = growthAtYearFromFlatForecasts(forecasts, i, year);
    }
    const previousUniform = mat.uniforms.uGrowthNow.value as Float32Array;
    mat.uniforms.uGrowthNow.value = next;

    const firstJob = jobs[0];
    const sampleFallbackAtRequestedYear = firstJob ? getCurrentYearGrowth(firstJob, year).value : null;
    const sampleForecastAtRequestedYear = forecasts.length > 0 ? growthAtYearFromFlatForecasts(forecasts, 0, year) : null;
    // #region agent log
    fetch('http://127.0.0.1:7252/ingest/46718283-b9ba-4afd-b6a8-059ca781fa06',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'9fe126'},body:JSON.stringify({sessionId:'9fe126',runId:'run4',hypothesisId:'H8',location:'Terrain.tsx:244',message:'terrain_uniforms_applied',data:{requestedYear:year,peakCount,materialUuid:mat.uuid,previousFirstGrowth:previousUniform?.[0] ?? null,nextFirstGrowth:next[0],sampleGrowth:Array.from(next.slice(0,3)),sampleFirstJobId:firstJob?.id ?? null,sampleFallbackAtRequestedYear,sampleForecastAtRequestedYear},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
  }, [year, meshKey]);

  useFrame((state) => {
    if (!materialRef.current) return;
    materialRef.current.uniforms.uTime.value = state.clock.getElapsedTime();
    const currentGrowth = materialRef.current.uniforms.uGrowthNow.value as Float32Array | undefined;
    const frameKey = `${year}-${currentGrowth?.[0] ?? 'na'}-${currentGrowth?.[1] ?? 'na'}-${materialRef.current.uuid}`;
    if (lastFrameLogRef.current !== frameKey) {
      lastFrameLogRef.current = frameKey;
      // #region agent log
      fetch('http://127.0.0.1:7252/ingest/46718283-b9ba-4afd-b6a8-059ca781fa06',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'9fe126'},body:JSON.stringify({sessionId:'9fe126',runId:'run4',hypothesisId:'H10',location:'Terrain.tsx:255',message:'terrain_frame_observed_uniforms',data:{year,materialUuid:materialRef.current.uuid,firstGrowth:currentGrowth?.[0] ?? null,secondGrowth:currentGrowth?.[1] ?? null,peakCount:materialRef.current.uniforms.uPeakCount.value},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
    }
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
