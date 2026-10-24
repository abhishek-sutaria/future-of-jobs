import { SHADER_VISUAL, SHADER_COLORS, SCENE } from '../../config/constants';

/** Region rectangles uploaded to the ground shader (one vec4 each). */
export const MAX_REGIONS = 22;

const f = (n: number) => n.toFixed(4);

// Shared terrain styling, so the peaks and the ground read as the one surface
// the old single-mesh terrain was: dark base, faint grid, height isolines,
// fresnel rim, risk colour rising with height.
const SHARED = /* glsl */ `
  const vec3 TERRAIN_BASE = ${SHADER_COLORS.TERRAIN_BASE};
  const vec3 GRID_COLOR = ${SHADER_COLORS.GRID};
  float gridLine(vec2 xz) {
    vec2 uv = xz / ${f(SCENE.PLANE_SIZE)} + 0.5;
    float gx = step(${f(SHADER_VISUAL.GRID_THRESHOLD)}, fract(uv.x * ${f(SHADER_VISUAL.GRID_FREQUENCY)}));
    float gy = step(${f(SHADER_VISUAL.GRID_THRESHOLD)}, fract(uv.y * ${f(SHADER_VISUAL.GRID_FREQUENCY)}));
    return max(gx, gy);
  }
`;

export const peakVertexShader = /* glsl */ `
  // Unit bell: x/z in [-1, 1], y in [0, 1]. One instance per role.
  attribute vec4 aPeak;     // world x, world z, footprint radius, height (world units)
  attribute vec3 aColor;    // Job Security colour, or the neutral "not scored yet" slate
  attribute float aEmph;    // 1 = full colour, lower = dimmed by the Kelley filter
  attribute float aIndex;   // instance index within this region, for the hover glow

  uniform float uGroundY;
  uniform float uRegionDim; // 1 = this region in focus or no focus; lower = dimmed
  uniform float uRegionLift; // 1 = true height; lower = flattened while another region is in focus
  uniform float uHover;     // hovered instance index, or -1

  varying vec3 vColor;
  varying vec3 vWorld;
  varying float vElev;
  varying float vEmph;
  varying float vHover;

  void main() {
    float h = aPeak.w * uRegionLift;
    vec3 world = vec3(aPeak.x + position.x * aPeak.z, uGroundY + position.y * h, aPeak.y + position.z * aPeak.z);
    vWorld = world;
    vElev = position.y * h;
    vColor = aColor;
    vEmph = aEmph * uRegionDim;
    vHover = abs(aIndex - uHover) < 0.5 ? 1.0 : 0.0;
    gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
  }
`;

export const peakFragmentShader = /* glsl */ `
  ${SHARED}
  varying vec3 vColor;
  varying vec3 vWorld;
  varying float vElev;
  varying float vEmph;
  varying float vHover;

  void main() {
    vec3 fdx = dFdx(vWorld);
    vec3 fdy = dFdy(vWorld);
    vec3 normal = normalize(cross(fdx, fdy));
    vec3 viewDir = normalize(cameraPosition - vWorld);

    // Colour rises with height as on the old terrain; small peaks still carry
    // enough of it to be told apart from the ground.
    float heightMix = max(
      smoothstep(${f(SHADER_VISUAL.HEIGHT_MIX_MIN)}, ${f(SHADER_VISUAL.HEIGHT_MIX_MAX)}, vElev),
      0.55 * smoothstep(0.0, 0.25, vElev)
    );
    vec3 color = mix(TERRAIN_BASE, vColor, heightMix * 0.92);

    color = mix(color, GRID_COLOR, gridLine(vWorld.xz) * 0.3);
    float isoline = step(${f(SHADER_VISUAL.ISOLINE_THRESHOLD)}, fract(vElev * ${f(SHADER_VISUAL.ISOLINE_FREQUENCY)}));
    vec3 isolineColor = mix(${SHADER_COLORS.ISOLINE_DARK}, ${SHADER_COLORS.ISOLINE_BRIGHT}, heightMix);
    color = mix(color, isolineColor, isoline * 0.2);

    float fresnel = pow(1.0 - abs(dot(normal, viewDir)), 2.0);
    color += ${SHADER_COLORS.RIM_LIGHTING} * fresnel * 0.3;

    color = mix(TERRAIN_BASE * 0.85, color, vEmph);
    color += vec3(0.16, 0.22, 0.28) * vHover;

    gl_FragColor = vec4(color, 1.0);
  }
`;

export const groundVertexShader = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

export const groundFragmentShader = /* glsl */ `
  ${SHARED}
  uniform vec4 uRegions[${MAX_REGIONS}];   // x0, z0, x1, z1
  uniform float uHoverRegion;              // index or -1
  uniform float uFocusRegion;              // index or -1
  uniform vec4 uBounds;                    // world rectangle the regions fill
  uniform vec2 uMouse;
  varying vec3 vWorld;

  void main() {
    vec2 p = vWorld.xz;
    vec3 color = TERRAIN_BASE;
    color = mix(color, GRID_COLOR, gridLine(p) * 0.3);

    float region = -1.0;
    float edge = 1e6;
    for (int i = 0; i < ${MAX_REGIONS}; i++) {
      vec4 r = uRegions[i];
      if (p.x >= r.x && p.x <= r.z && p.y >= r.y && p.y <= r.w) {
        region = float(i);
        edge = min(min(p.x - r.x, r.z - p.x), min(p.y - r.y, r.w - p.y));
        break; // regions never overlap
      }
    }

    if (region >= 0.0) {
      // Alternate a faint lift between neighbours so regions read apart.
      float lift = mod(region, 2.0) < 0.5 ? 0.018 : 0.035;
      color += vec3(lift * 0.8, lift, lift * 1.4);
      float isHover = abs(region - uHoverRegion) < 0.5 ? 1.0 : 0.0;
      float isFocus = abs(region - uFocusRegion) < 0.5 ? 1.0 : 0.0;
      float dimmed = (uFocusRegion >= 0.0 && isFocus < 0.5) ? 1.0 : 0.0;
      color += vec3(0.03, 0.06, 0.09) * isHover;
      color *= 1.0 - 0.45 * dimmed;
      // Border drawn on the boundary itself, so every region keeps its full area.
      float border = 1.0 - smoothstep(0.04, 0.16, edge);
      vec3 borderColor = mix(vec3(0.16, 0.3, 0.42), vec3(0.35, 0.75, 0.9), max(isHover, isFocus));
      color = mix(color, borderColor, border * (0.55 + 0.45 * max(isHover, isFocus)) * (1.0 - 0.6 * dimmed));
    }

    float mouseDist = distance(p, uMouse);
    color += ${SHADER_COLORS.CURSOR} * smoothstep(${f(SHADER_VISUAL.MOUSE_HIGHLIGHT_FALLOFF)}, 0.0, mouseDist) * 0.2;

    // Fade out past the edge of the regions, as the old disc faded at its rim.
    vec2 outside = max(vec2(0.0), max(uBounds.xy - p, p - uBounds.zw));
    float alpha = 1.0 - smoothstep(0.5, 5.0, length(outside));
    gl_FragColor = vec4(color, alpha);
  }
`;
