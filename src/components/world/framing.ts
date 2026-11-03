import type { PerspectiveCamera } from 'three';
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
 * time, looking at the middle of the stage's rectangle (the stage map puts it
 * at the origin), so orbiting turns it about its own centre. Portrait and
 * landscape as the live view picks them, from the camera's fov.
 */
export function stageFraming(fovDeg: number): Framing {
    const position = fovDeg === SCENE.CAMERA_PORTRAIT_FOV ? SCENE.CAMERA_PORTRAIT_POSITION : SCENE.CAMERA_INITIAL_POSITION;
    return { target: [0, 0, 0], position: [position[0], position[1], position[2]] };
}

/** How far down the viewport a point on the stage's ground straight ahead, at depth z, lands from the stage's home camera, in pixels. */
export function stageGroundY(fovDeg: number, viewportHeight: number, z = 0): number {
    const { position } = stageFraming(fovDeg);
    const [, py, pz] = position;
    const length = Math.hypot(py, pz);
    // Looking at the origin from (0, py, pz): the camera's forward and up in the y-z plane.
    const [fy, fz] = [-py / length, -pz / length];
    const [uy, uz] = [-fz, fy];
    const [dy, dz] = [GROUND_Y - py, z - pz];
    const ndcY = (dy * uy + dz * uz) / ((dy * fy + dz * fz) * Math.tan((fovDeg * Math.PI) / 360));
    return ((1 - ndcY) / 2) * viewportHeight;
}

/**
 * The y offset for camera.setViewOffset that lands the stage's rectangle in the
 * middle of the free band on a phone, half way between where its far and near
 * edges land, without moving the camera: the position, the angle and the fov
 * all stay the live view's, and only the picture slides. Negative slides it
 * down. It goes through the projection matrix, so anything that projects or
 * raycasts with the camera follows it exactly.
 */
export function stageViewOffset(fovDeg: number, viewportHeight: number, bandTop: number, bandBottom: number, outline: Rect): number {
    const middle = (stageGroundY(fovDeg, viewportHeight, outline.z0) + stageGroundY(fovDeg, viewportHeight, outline.z1)) / 2;
    return middle - (bandTop + bandBottom) / 2;
}

/** How far inside the free band a desktop stage's near and far edges stay, in pixels. */
export const STAGE_BAND_MARGIN = 8;

/** How the picture is moved on screen at a stage, without moving the camera. */
export interface StageView {
    /** Pixels the picture slides up (negative: down), as stageViewOffset gives them. */
    offsetY: number;
    /** How many times more of the scene the picture shows: 1, unless the band is too short for the rectangle at the live camera. */
    scale: number;
}

export const NO_STAGE_VIEW: Readonly<StageView> = { offsetY: 0, scale: 1 };

/**
 * The desktop's view of a stage: the least slide that puts its rectangle
 * between the top chrome and the year slider, `margin` clear of both. A window
 * tall enough for it (1920x958) keeps the picture where it is; a short laptop
 * window (1470x723, down to 1280x680) slides it up until the near edge clears
 * the slider. Only a window too short even for that also shows a little more of
 * the scene, centred in the band. The camera's position, angle and fov never
 * change, so orbiting still turns about the rectangle's centre and the hand
 * zoom-out rule measures the same distance. Apply with applyStageView.
 */
export function stageFitView(
    fovDeg: number, viewportHeight: number, bandTop: number, bandBottom: number, outline: Rect, margin = STAGE_BAND_MARGIN,
): StageView {
    const far = stageGroundY(fovDeg, viewportHeight, outline.z0);
    const near = stageGroundY(fovDeg, viewportHeight, outline.z1);
    const top = bandTop + margin;
    const bottom = bandBottom - margin;
    if (near - far > bottom - top) {
        const scale = (near - far) / Math.max(1, bottom - top);
        return { offsetY: (far + near) / 2 - (scale * (bandTop + bandBottom)) / 2, scale };
    }
    if (near > bottom) return { offsetY: near - bottom, scale: 1 };
    if (far < top) return { offsetY: far - top, scale: 1 };
    return { ...NO_STAGE_VIEW };
}

/**
 * Puts a StageView on the camera through setViewOffset: the picture slides by
 * offsetY and, past scale 1, shows that much more about the same centre. It
 * goes through the projection matrix, so labels, pins and hit tests follow it.
 */
export function applyStageView(camera: PerspectiveCamera, width: number, height: number, view: StageView): void {
    if (view.offsetY === 0 && view.scale === 1) camera.clearViewOffset();
    else camera.setViewOffset(width, height, (width * (1 - view.scale)) / 2, view.offsetY, width * view.scale, height * view.scale);
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
