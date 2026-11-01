import { SCENE } from '../../config/constants';
import { rectDepth, rectWidth, WORLD_BOUNDS, type Rect } from '../../utils/worldLayout';
import { GROUND_Y } from './worldScene';

export interface Framing {
    target: [number, number, number];
    position: [number, number, number];
}

/** Share of the viewport height left for the terrain between the header and the year slider. */
const USABLE_HEIGHT = 0.68;

/**
 * Camera framing that fits a rectangle of the ground in the viewport, seen
 * from the south (+z). Portrait screens look down more steeply so the depth
 * uses their height.
 */
export function frameRect(rect: Rect, fovDeg: number, aspect: number): Framing {
    const portrait = aspect < 1;
    const elevation = ((portrait ? 76 : 46) * Math.PI) / 180;
    const margin = 1.06;
    const vHalf = ((fovDeg * Math.PI) / 180) / 2;
    const hHalf = Math.atan(Math.tan(vHalf) * aspect);
    const w = rectWidth(rect) * margin;
    const d = rectDepth(rect) * margin;
    // The near edge is closer to the camera than the target, so it projects
    // wider; leave room for that on top of the plain half-width.
    const byWidth = (w / 2) / Math.tan(hHalf) + (d / 2) * Math.cos(elevation);
    const byDepth = ((d / 2) * Math.sin(elevation) + 2) / (Math.tan(vHalf) * USABLE_HEIGHT);
    const dist = Math.min(SCENE.MAX_CAMERA_DISTANCE, Math.max(SCENE.MIN_CAMERA_DISTANCE + 4, byWidth, byDepth));
    const cx = (rect.x0 + rect.x1) / 2;
    const cz = (rect.z0 + rect.z1) / 2;
    // Aim a little below the centre: the year slider covers more of the
    // bottom of the screen than the header covers of the top.
    const target: [number, number, number] = [cx, GROUND_Y + 1, cz + d * 0.04];
    return {
        target,
        position: [target[0], target[1] + dist * Math.sin(elevation), target[2] + dist * Math.cos(elevation)],
    };
}

export function worldFraming(fovDeg: number, aspect: number): Framing {
    return frameRect(WORLD_BOUNDS, fovDeg, aspect);
}

/**
 * Every family and field: the live 3D view's camera, the same numbers every
 * time. Portrait and landscape as the live view picks them, from the camera's fov.
 */
export function stageFraming(fovDeg: number): Framing {
    const position = fovDeg === SCENE.CAMERA_PORTRAIT_FOV ? SCENE.CAMERA_PORTRAIT_POSITION : SCENE.CAMERA_INITIAL_POSITION;
    return { target: [0, 0, 0], position: [position[0], position[1], position[2]] };
}

/** How far down the viewport the middle of the disc lands from the stage's home camera, in pixels. */
export function stageDiscY(fovDeg: number, viewportHeight: number): number {
    const { position } = stageFraming(fovDeg);
    const [, py, pz] = position;
    const length = Math.hypot(py, pz);
    // Looking at the origin from (0, py, pz): the camera's forward and up in the y-z plane.
    const [fy, fz] = [-py / length, -pz / length];
    const [uy, uz] = [-fz, fy];
    const [dy, dz] = [GROUND_Y - py, -pz];
    const ndcY = (dy * uy + dz * uz) / ((dy * fy + dz * fz) * Math.tan((fovDeg * Math.PI) / 360));
    return ((1 - ndcY) / 2) * viewportHeight;
}

/**
 * The y offset for camera.setViewOffset that lands the middle of the disc in the
 * middle of the free band on a phone, without moving the camera: the position,
 * the angle and the fov all stay the live view's, and only the picture slides.
 * Negative slides it down. It goes through the projection matrix, so anything
 * that projects or raycasts with the camera follows it exactly.
 */
export function stageViewOffset(fovDeg: number, viewportHeight: number, bandTop: number, bandBottom: number): number {
    return stageDiscY(fovDeg, viewportHeight) - (bandTop + bandBottom) / 2;
}

/** `framing` moved along its own line of sight to `distance` from its target. */
export function atDistance(framing: Framing, distance: number): Framing {
    const k = distance / framingDistance(framing);
    const [tx, ty, tz] = framing.target;
    const [px, py, pz] = framing.position;
    return { target: framing.target, position: [tx + (px - tx) * k, ty + (py - ty) * k, tz + (pz - tz) * k] };
}

export function framingDistance({ position: p, target: t }: Framing): number {
    return Math.hypot(p[0] - t[0], p[1] - t[1], p[2] - t[2]);
}
