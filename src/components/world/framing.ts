import { SCENE } from '../../config/constants';
import { rectDepth, rectWidth, WORLD_BOUNDS, type Rect } from '../../utils/worldLayout';
import { GROUND_Y } from './worldScene';

export interface Framing {
    target: [number, number, number];
    position: [number, number, number];
}

/** Share of the viewport height left for the terrain between the header and the year slider. */
const USABLE_HEIGHT = 0.68;

export interface FrameOptions {
    elevationDeg?: number;
    margin?: number;
    /** Extra height (world units) to keep in view above the rectangle, e.g. for tall peaks and their labels. */
    lift?: number;
    /** Share of the viewport height free of chrome (header, fields bar, year slider). */
    usableHeight?: number;
    /** Where that free band's centre sits, from -1 (top) to 1 (bottom) of the viewport; 0 = centre. */
    bandCenter?: number;
}

/**
 * Camera framing that fits a rectangle of the ground in the viewport, seen
 * from the south (+z) at `elevationDeg` above the horizon. Portrait screens
 * look down more steeply so the depth uses their height.
 */
export function frameRect(rect: Rect, fovDeg: number, aspect: number, opts: FrameOptions = {}): Framing {
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
    const usable = Math.max(0.3, Math.min(1, opts.usableHeight ?? USABLE_HEIGHT));
    const byDepth = ((d / 2) * Math.sin(elevation) + (opts.lift ?? 2)) / (Math.tan(vHalf) * usable);
    const dist = Math.min(SCENE.MAX_CAMERA_DISTANCE, Math.max(SCENE.MIN_CAMERA_DISTANCE + 4, byWidth, byDepth));
    const cx = (rect.x0 + rect.x1) / 2;
    const cz = (rect.z0 + rect.z1) / 2;
    // Aim a little below the centre: the year slider covers more of the
    // bottom of the screen than the header covers of the top.
    const aim: [number, number, number] = [cx, GROUND_Y + 1, cz + d * 0.04];
    // Centre the rectangle in the free band rather than the viewport: look at
    // a point shifted along the camera's up vector so `aim` lands at bandCenter.
    const k = (opts.bandCenter ?? 0) * dist * Math.tan(vHalf);
    const target: [number, number, number] = [aim[0], aim[1] + k * Math.cos(elevation), aim[2] - k * Math.sin(elevation)];
    return {
        target,
        position: [target[0], target[1] + dist * Math.sin(elevation), target[2] + dist * Math.cos(elevation)],
    };
}

export function worldFraming(fovDeg: number, aspect: number): Framing {
    return frameRect(WORLD_BOUNDS, fovDeg, aspect);
}
