import { SHADER_COLORS, SHADER_VISUAL } from '../../config/constants';
import { STAGE_HEIGHT_RANGE } from '../../utils/stageBake';

/**
 * The live Terrain.tsx surface. Everything here matches origin/main's shaders
 * line for line, including the way vPos mixes frames, so a stage reads as the
 * same landscape. Three things differ: the hills come from baked textures
 * rather than a 50-entry uniform loop, they rise from flat on the way in, and
 * the Kelley filter can dim what it leaves out.
 */
export const stageVertexShader = /* glsl */ `
  varying vec2 vUv;
  varying float vElevation;
  varying vec3 vColor;
  varying float vEmphasis;
  varying vec3 vPos;

  uniform sampler2D uHeights;  // 2025 height, 2035 height
  uniform sampler2D uColors;   // blended colour, Kelley emphasis
  uniform float uTexels;       // texels along one side
  uniform float uYearMix;      // 0 = 2025, 1 = 2035
  uniform float uRise;         // 0 = flat, 1 = full height

  void main() {
    vUv = uv;
    vec3 pos = position;

    // Mesh vertices and texels line up one to one, so this reads each vertex's own texel.
    vec2 texel = (uv * (uTexels - 1.0) + 0.5) / uTexels;
    #ifdef STAGE_PACKED
      vec4 packed = texture2D(uHeights, texel) * 255.0;
      vec2 years = vec2(packed.r * 256.0 + packed.g, packed.b * 256.0 + packed.a) * ${(STAGE_HEIGHT_RANGE / 65535).toFixed(10)};
    #else
      vec2 years = texture2D(uHeights, texel).rg;
    #endif
    vec4 color = texture2D(uColors, texel);

    vColor = color.rgb;
    vEmphasis = color.a;
    vElevation = mix(years.x, years.y, uYearMix) * uRise;
    pos.z += vElevation;
    vPos = pos;

    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  }
`;

export const stageFragmentShader = /* glsl */ `
  varying vec2 vUv;
  varying float vElevation;
  varying vec3 vColor;
  varying float vEmphasis;
  varying vec3 vPos;

  uniform vec2 uMouse;
  uniform float uFade;    // the whole disc, for going on and off stage
  uniform float uKelley;  // 0 = every job at full colour, 1 = Kelley filter on

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

    float heightMix = smoothstep(${SHADER_VISUAL.HEIGHT_MIX_MIN.toFixed(1)}, ${SHADER_VISUAL.HEIGHT_MIX_MAX.toFixed(1)}, vElevation);
    vec3 dataPeakColor = mix(baseColor, vColor, heightMix * 0.92);

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
    finalColor = mix(baseColor * 0.85, finalColor, mix(1.0, vEmphasis, uKelley));
    finalColor += rim + cursorColor;

    float dist = distance(vUv, vec2(0.5));
    float alpha = 1.0 - smoothstep(${SHADER_VISUAL.EDGE_FADE_START}, ${SHADER_VISUAL.EDGE_FADE_END}, dist);

    gl_FragColor = vec4(finalColor, alpha * uFade);
  }
`;

/** The stage mesh's segments per side. Vertex work here is two texture reads, not a loop over every job. */
export const STAGE_SEGMENTS = { desktop: 256, mobile: 128 } as const;
