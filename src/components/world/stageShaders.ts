import { SCENE, SHADER_COLORS, SHADER_VISUAL } from '../../config/constants';
import { STAGE_HEIGHT_RANGE } from '../../utils/stageBake';

/** Tile rectangles a stage can draw: a family's fields, or a field's minor groups (Production has 9). */
export const MAX_STAGE_TILES = 12;
const f = (n: number) => n.toFixed(4);

/**
 * The live Terrain.tsx surface, on the stage's own rectangle. The colouring,
 * isolines, rim light and cursor glow match origin/main's shaders line for line,
 * including the way vPos mixes frames, so a stage reads as the same landscape.
 * What differs: the hills come from baked textures rather than a 50-entry
 * uniform loop, their height can be scaled to match the layer they hand over
 * from, the Kelley filter can dim what it leaves out, and the map's borders are
 * drawn on it, so it ends in the world map's straight edge instead of a fade.
 */
export const stageVertexShader = /* glsl */ `
  varying vec2 vUv;
  varying float vElevation;
  varying vec3 vColor;
  varying float vEmphasis;
  varying vec3 vPos;
  varying vec2 vStage;

  uniform sampler2D uHeights;  // 2025 height, 2035 height
  uniform sampler2D uColors;   // blended colour, Kelley emphasis
  uniform vec2 uTexels;        // texels along x, along z
  uniform vec2 uCentre;        // stage position of the mesh's middle
  uniform float uYearMix;      // 0 = 2025, 1 = 2035
  uniform float uRise;         // height multiplier: 1 on the stage's own scale

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
    // The mesh lies rotated, so its y axis runs along -z.
    vStage = vec2(position.x, -position.y) + uCentre;

    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  }
`;

export const stageFragmentShader = /* glsl */ `
  varying vec2 vUv;
  varying float vElevation;
  varying vec3 vColor;
  varying float vEmphasis;
  varying vec3 vPos;
  varying vec2 vStage;

  uniform vec2 uMouse;     // stage position of the pointer
  uniform float uFade;     // the whole surface, for handing over between levels
  uniform float uKelley;   // 0 = every job at full colour, 1 = a filter (Kelley or IU school) on
  uniform vec4 uOutline;   // the stage's edge, x0, z0, x1, z1
  uniform vec4 uTiles[${MAX_STAGE_TILES}]; // field tiles or minor-group blocks; unused ones far away
  uniform float uTileLine; // how strongly tile borders draw: 1 for fields, fainter for minor groups

  void main() {
    vec3 fdx = dFdx(vPos);
    vec3 fdy = dFdy(vPos);
    vec3 normal = normalize(cross(fdx, fdy));
    vec3 viewDir = normalize(cameraPosition - vPos);

    vec3 baseColor = ${SHADER_COLORS.TERRAIN_BASE};

    // The live grid's spacing, in stage units.
    vec2 g = vStage / ${f(SCENE.PLANE_SIZE)} + 0.5;
    float gridX = step(${SHADER_VISUAL.GRID_THRESHOLD}, fract(g.x * ${SHADER_VISUAL.GRID_FREQUENCY}.0));
    float gridY = step(${SHADER_VISUAL.GRID_THRESHOLD}, fract(g.y * ${SHADER_VISUAL.GRID_FREQUENCY}.0));
    float grid = max(gridX, gridY);

    // Tiles, as the world map draws its fields: a faint lift alternating between neighbours.
    float tile = -1.0;
    float tileEdge = 1e6;
    for (int i = 0; i < ${MAX_STAGE_TILES}; i++) {
      vec4 r = uTiles[i];
      if (vStage.x >= r.x && vStage.x <= r.z && vStage.y >= r.y && vStage.y <= r.w) {
        tile = float(i);
        tileEdge = min(min(vStage.x - r.x, r.z - vStage.x), min(vStage.y - r.y, r.w - vStage.y));
        break; // tiles never overlap
      }
    }
    if (tile >= 0.0) {
      float lift = (mod(tile, 2.0) < 0.5 ? 0.018 : 0.035) * uTileLine;
      baseColor += vec3(lift * 0.8, lift, lift * 1.4);
    }

    vec3 gridColor = ${SHADER_COLORS.GRID};

    float heightMix = smoothstep(${SHADER_VISUAL.HEIGHT_MIX_MIN.toFixed(1)}, ${SHADER_VISUAL.HEIGHT_MIX_MAX.toFixed(1)}, vElevation);
    vec3 dataPeakColor = mix(baseColor, vColor, heightMix * 0.92);

    float isoline = step(${SHADER_VISUAL.ISOLINE_THRESHOLD}, fract(vElevation * ${SHADER_VISUAL.ISOLINE_FREQUENCY.toFixed(1)}));
    vec3 isolineColor = mix(${SHADER_COLORS.ISOLINE_DARK}, ${SHADER_COLORS.ISOLINE_BRIGHT}, heightMix);

    float mouseDist = distance(vStage, uMouse);
    float mouseHighlight = smoothstep(${SHADER_VISUAL.MOUSE_HIGHLIGHT_FALLOFF.toFixed(1)}, 0.0, mouseDist);
    vec3 cursorColor = ${SHADER_COLORS.CURSOR} * mouseHighlight * 0.2;

    float fresnel = pow(1.0 - abs(dot(normal, viewDir)), 2.0);
    vec3 rim = ${SHADER_COLORS.RIM_LIGHTING} * fresnel * 0.3;

    vec3 finalColor = dataPeakColor;
    finalColor = mix(finalColor, gridColor, grid * 0.3);
    finalColor = mix(finalColor, isolineColor, isoline * 0.2);
    finalColor = mix(baseColor * 0.85, finalColor, mix(1.0, vEmphasis, uKelley));
    finalColor += rim + cursorColor;

    // The world map's borders: a thin line round every tile, a wider, lighter one round the stage.
    float tileBorder = 1.0 - smoothstep(0.04, 0.16, tileEdge);
    finalColor = mix(finalColor, vec3(0.16, 0.3, 0.42), tileBorder * 0.55 * uTileLine);
    float outlineEdge = min(min(vStage.x - uOutline.x, uOutline.z - vStage.x), min(vStage.y - uOutline.y, uOutline.w - vStage.y));
    float outline = 1.0 - smoothstep(0.12, 0.42, outlineEdge);
    finalColor = mix(finalColor, vec3(0.42, 0.68, 0.8), outline * 0.6);

    gl_FragColor = vec4(finalColor, uFade);
  }
`;

/** Mesh segments along a stage's long side. Vertex work here is two texture reads, not a loop over every job. */
export const STAGE_SEGMENTS = { desktop: 256, mobile: 128 } as const;

/** Tile borders on a family's stage are the world map's field borders; a field's minor groups draw fainter. */
export const TILE_LINE = { family: 1, field: 0.45 } as const;
