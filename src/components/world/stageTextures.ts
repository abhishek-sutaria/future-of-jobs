import { DataTexture, NearestFilter, RGBAFormat, RGFormat, FloatType, UnsignedByteType } from 'three';
import { packHeights, type StageBake } from '../../utils/stageBake';

/** `float` reads heights straight from a float texture; `packed` carries them in 8-bit channels. */
export type StageTextureFormat = 'float' | 'packed';

/**
 * Whether this GPU really can read a float texture from a vertex shader. Asked
 * of the GPU rather than assumed: it renders one point in a throwaway context,
 * so three's own GL state is never touched, and checks the value came through.
 * WebGL2 promises this, but a driver that returns zeros would flatten every
 * stage with no error at all.
 */
function floatVertexTexturesWork(): boolean {
    if (typeof document === 'undefined') return false;
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const gl = canvas.getContext('webgl2');
    if (!gl) return false;
    try {
        if (gl.getParameter(gl.MAX_VERTEX_TEXTURE_IMAGE_UNITS) < 2) return false;
        const shader = (type: number, source: string) => {
            const s = gl.createShader(type)!;
            gl.shaderSource(s, source);
            gl.compileShader(s);
            return s;
        };
        const program = gl.createProgram()!;
        gl.attachShader(program, shader(gl.VERTEX_SHADER, `#version 300 es
            precision highp float;
            uniform highp sampler2D t;
            out float v;
            void main() { v = texture(t, vec2(0.5)).g; gl_Position = vec4(0.0, 0.0, 0.0, 1.0); gl_PointSize = 1.0; }`));
        gl.attachShader(program, shader(gl.FRAGMENT_SHADER, `#version 300 es
            precision highp float;
            in float v;
            out vec4 color;
            void main() { color = vec4(abs(v - 1234.5) < 0.01 ? 1.0 : 0.0, 0.0, 0.0, 1.0); }`));
        gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return false;
        gl.useProgram(program);
        gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG32F, 1, 1, 0, gl.RG, gl.FLOAT, new Float32Array([0, 1234.5]));
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.drawArrays(gl.POINTS, 0, 1);
        const pixel = new Uint8Array(4);
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
        return gl.getError() === gl.NO_ERROR && pixel[0] === 255;
    } finally {
        gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
}

let checked: StageTextureFormat | null = null;

export function stageTextureFormat(): StageTextureFormat {
    return (checked ??= floatVertexTexturesWork() ? 'float' : 'packed');
}

export interface StageTextures {
    heights: DataTexture;
    colors: DataTexture;
    dispose: () => void;
}

/**
 * Nearest filtering throughout: each mesh vertex reads its own texel, so nothing
 * needs interpolating, and float textures are not filterable on most phones.
 */
export function createStageTextures(bake: StageBake, format: StageTextureFormat): StageTextures {
    const { cols, rows } = bake;
    const heights = format === 'float'
        ? new DataTexture(bake.heights, cols, rows, RGFormat, FloatType)
        : new DataTexture(packHeights(bake.heights), cols, rows, RGBAFormat, UnsignedByteType);
    const colors = new DataTexture(bake.colors, cols, rows, RGBAFormat, UnsignedByteType);
    for (const texture of [heights, colors]) {
        texture.minFilter = NearestFilter;
        texture.magFilter = NearestFilter;
        texture.generateMipmaps = false;
        texture.needsUpdate = true;
    }
    return { heights, colors, dispose: () => { heights.dispose(); colors.dispose(); } };
}
