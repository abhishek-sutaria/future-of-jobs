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
 * from the south (+z) at `elevationDeg` above the horizon. Portrait screens
 * look down more steeply so the depth uses their height.
 */
export function frameRect(rect: Rect, fovDeg: number, aspect: number, opts: { elevationDeg?: number; margin?: number; lift?: number } = {}): Framing {
    const portrait = aspect < 1;
    const elevation = ((opts.elevationDeg ?? (portrait ? 62 : 46)) * Math.PI) / 180;
    const margin = opts.margin ?? 1.06;
    const vHalf = ((fovDeg * Math.PI) / 180) / 2;
    const hHalf = Math.atan(Math.tan(vHalf) * aspect);
    const w = rectWidth(rect) * margin;
    const d = rectDepth(rect) * margin;
    // The near edge is closer to the camera than the target, so it projects
    // wider; leave room for that on top of the plain half-width.
    const byWidth = (w / 2) / Math.tan(hHalf) + (d / 2) * Math.cos(elevation);
    const byDepth = ((d / 2) * Math.sin(elevation) + (opts.lift ?? 2)) / (Math.tan(vHalf) * USABLE_HEIGHT);
    const dist = Math.min(SCENE.MAX_CAMERA_DISTANCE, Math.max(SCENE.MIN_CAMERA_DISTANCE + 4, byWidth, byDepth));
    const cx = (rect.x0 + rect.x1) / 2;
    const cz = (rect.z0 + rect.z1) / 2;
    // Aim a little below the centre: the year slider covers more of the
    // bottom of the screen than the header covers of the top.
    const target: [number, number, number] = [cx, GROUND_Y + 1, cz + d * 0.04];
    return {
        target,
        position: [cx, target[1] + dist * Math.sin(elevation), target[2] + dist * Math.cos(elevation)],
    };
}

export function worldFraming(fovDeg: number, aspect: number): Framing {
    return frameRect(WORLD_BOUNDS, fovDeg, aspect);
}
