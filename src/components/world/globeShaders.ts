import { SHADER_COLORS, SHADER_VISUAL } from '../../config/constants';

const f = (n: number) => n.toFixed(4);

// Faint latitude/longitude lines every 15°, anti-aliased with screen-space
// derivatives. They only show the globe turning; they mark nothing.
const GRATICULE = /* glsl */ `
  float graticule(vec3 n) {
    float lat = asin(clamp(n.y, -1.0, 1.0)) * 3.8197; // degrees / 15
    float lon = atan(n.x, n.z) * 3.8197;
    float w = max(fwidth(lat), 1e-4);
    float gLat = 1.0 - smoothstep(0.0, 1.5 * w, abs(fract(lat + 0.5) - 0.5));
    float wLon = w / max(sqrt(1.0 - n.y * n.y), 0.25);
    float gLon = 1.0 - smoothstep(0.0, 1.5 * wLon, abs(fract(lon + 0.5) - 0.5));
    return max(gLat, gLon);
  }
`;

const SPHERE_VERTEX = /* glsl */ `
  varying vec3 vPos;
  void main() {
    vPos = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const oceanVertexShader = SPHERE_VERTEX;

/** Dark sea, a little lighter toward the limb, with a cool rim. */
export const oceanFragmentShader = /* glsl */ `
  ${GRATICULE}
  uniform vec3 uLightDir;
  varying vec3 vPos;
  void main() {
    vec3 n = normalize(vPos);
    vec3 v = normalize(cameraPosition - vPos);
    float facing = clamp(dot(n, v), 0.0, 1.0);
    vec3 color = mix(vec3(0.034, 0.064, 0.105), vec3(0.018, 0.034, 0.062), facing);
    color *= 0.78 + 0.32 * max(dot(n, uLightDir), 0.0);
    color += vec3(0.05, 0.09, 0.13) * graticule(n) * 0.45;
    color += vec3(0.10, 0.28, 0.40) * pow(1.0 - facing, 2.5) * 0.5;
    gl_FragColor = vec4(color, 1.0);
  }
`;

export const atmosphereVertexShader = /* glsl */ `
  varying vec3 vNormalView;
  void main() {
    vNormalView = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/**
 * Drawn on the back faces of a slightly larger sphere, added on top: brightest
 * just outside the globe's edge, fading to nothing at the shell's own edge.
 * uInner is that edge's |normal.z|, sqrt(1 − (R / R_shell)²).
 */
export const atmosphereFragmentShader = /* glsl */ `
  uniform float uInner;
  varying vec3 vNormalView;
  void main() {
    float d = -normalize(vNormalView).z;
    float glow = pow(clamp(d / uInner, 0.0, 1.0), 2.2) * 0.42;
    // Premultiplied: the canvas is transparent, so the alpha must carry the
    // glow too or the shell would composite as an opaque dark ring.
    gl_FragColor = vec4(vec3(0.22, 0.58, 0.85) * glow, glow);
  }
`;

export const landVertexShader = /* glsl */ `
  attribute float aRegion; // continent index, SOC order
  attribute float aShore;  // distance to the coast, world units
  varying vec3 vPos;
  varying float vRegion;
  varying float vShore;
  void main() {
    vPos = position;
    vRegion = aRegion;
    vShore = aShore;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/** The continents: the flat map's region styling (alternating tint, glowing border) on the sphere. */
export const landFragmentShader = /* glsl */ `
  ${GRATICULE}
  const vec3 TERRAIN_BASE = ${SHADER_COLORS.TERRAIN_BASE};
  uniform float uHoverRegion;   // index or -1
  uniform float uFocusRegion;   // the continent being flown to, or -1
  uniform vec3 uMouse;          // pointer on the globe (unit vector), or zero
  uniform vec3 uLightDir;
  uniform float uRadius;
  varying vec3 vPos;
  varying float vRegion;
  varying float vShore;

  void main() {
    vec3 n = normalize(vPos);
    vec3 v = normalize(cameraPosition - vPos);
    float facing = clamp(dot(n, v), 0.0, 1.0);
    float region = floor(vRegion + 0.5);

    vec3 color = TERRAIN_BASE * 1.35;
    // Alternate a faint lift between neighbours so continents read apart.
    float lift = mod(region, 2.0) < 0.5 ? 0.022 : 0.04;
    color += vec3(lift * 0.8, lift, lift * 1.4);
    color *= 0.74 + 0.36 * max(dot(n, uLightDir), 0.0);
    color += vec3(0.05, 0.09, 0.13) * graticule(n) * 0.25;

    float isHover = abs(region - uHoverRegion) < 0.5 ? 1.0 : 0.0;
    float isFocus = abs(region - uFocusRegion) < 0.5 ? 1.0 : 0.0;
    float lit = max(isHover, isFocus);
    color += vec3(0.03, 0.06, 0.09) * lit;

    float shore = 1.0 - smoothstep(0.05, 0.5, vShore);
    vec3 shoreColor = mix(vec3(0.16, 0.3, 0.42), vec3(0.35, 0.75, 0.9), lit);
    color = mix(color, shoreColor, shore * (0.6 + 0.4 * lit));

    float mouseDist = length(n - uMouse) * uRadius;
    color += ${SHADER_COLORS.CURSOR} * smoothstep(${f(SHADER_VISUAL.MOUSE_HIGHLIGHT_FALLOFF)}, 0.0, mouseDist) * 0.2 * step(0.5, dot(uMouse, uMouse));
    color += ${SHADER_COLORS.RIM_LIGHTING} * pow(1.0 - facing, 3.0) * 0.35;
    gl_FragColor = vec4(color, 1.0);
  }
`;

export const globePeakVertexShader = /* glsl */ `
  // Unit bell: x/z in [-1, 1], y in [0, 1]. One instance per role.
  attribute vec3 aDir;      // unit normal at the peak's centre
  attribute vec2 aShape;    // footprint radius, national-scale height (world units)
  attribute vec3 aColor;    // Job Security colour, or the neutral "not scored yet" slate
  attribute float aEmph;    // 1 = full colour, lower = dimmed by the Kelley filter
  attribute float aIndex;   // instance index within this continent, for the hover glow

  uniform float uRadius;      // land surface
  uniform float uHeightScale; // the globe draws the national scale at this size
  uniform float uHover;       // hovered instance index, or -1

  varying vec3 vColor;
  varying vec3 vWorld;
  varying float vElev;
  varying float vEmph;
  varying float vHover;

  void main() {
    vec3 n = aDir;
    vec3 east = normalize(cross(vec3(0.0, 1.0, 0.0), n));
    vec3 north = cross(n, east);
    // The footprint is wrapped onto the sphere, and the peak rises along the
    // normal at its centre.
    vec3 base = normalize(n * uRadius + (east * position.x - north * position.z) * aShape.x) * uRadius;
    vec3 world = base + n * (position.y * aShape.y * uHeightScale);
    vWorld = world;
    // Colour follows the national-scale height, exactly as on the flat map.
    vElev = position.y * aShape.y;
    vColor = aColor;
    vEmph = aEmph;
    vHover = abs(aIndex - uHover) < 0.5 ? 1.0 : 0.0;
    gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
  }
`;

export const globePeakFragmentShader = /* glsl */ `
  const vec3 TERRAIN_BASE = ${SHADER_COLORS.TERRAIN_BASE};
  uniform vec3 uLightDir;
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

    float heightMix = max(
      smoothstep(${f(SHADER_VISUAL.HEIGHT_MIX_MIN)}, ${f(SHADER_VISUAL.HEIGHT_MIX_MAX)}, vElev),
      0.55 * smoothstep(0.0, 0.25, vElev)
    );
    vec3 color = mix(TERRAIN_BASE * 1.35, vColor, heightMix * 0.92);
    float isoline = step(${f(SHADER_VISUAL.ISOLINE_THRESHOLD)}, fract(vElev * ${f(SHADER_VISUAL.ISOLINE_FREQUENCY)}));
    vec3 isolineColor = mix(${SHADER_COLORS.ISOLINE_DARK}, ${SHADER_COLORS.ISOLINE_BRIGHT}, heightMix);
    color = mix(color, isolineColor, isoline * 0.2);
    color *= 0.8 + 0.3 * max(dot(normal, uLightDir), 0.0);

    float fresnel = pow(1.0 - abs(dot(normal, viewDir)), 2.0);
    color += ${SHADER_COLORS.RIM_LIGHTING} * fresnel * 0.3;

    color = mix(TERRAIN_BASE * 0.85, color, vEmph);
    color += vec3(0.16, 0.22, 0.28) * vHover;
    gl_FragColor = vec4(color, 1.0);
  }
`;
