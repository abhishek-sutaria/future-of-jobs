import { SCENE } from '../../config/constants';
import { rectDepth, rectWidth, WORLD_BOUNDS, type Rect } from '../../utils/worldLayout';
import { GLOBE_RADIUS, unitVector } from '../../utils/globeLayout';
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
    const elevation = ((opts.elevationDeg ?? (portrait ? 76 : 46)) * Math.PI) / 180;
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

/** Where the canvas first points before CameraRig turns it to the Kelley side: a longitude and latitude, radians. Layout, not data. */
export const GLOBE_FRONT = { lon: -0.5, lat: 0.32 } as const;
/** Steepest the globe camera goes, so a turn toward a far-north field still reads as a globe. */
export const GLOBE_MAX_TILT = 0.85;
/** Room kept around the globe (its radius, plus peaks and atmosphere) in the default view. */
const GLOBE_FIT = GLOBE_RADIUS * 1.2;

/**
 * Camera distance that fits the whole globe in the band the chrome leaves
 * free (CameraRig shifts the projection so the globe sits in the middle of
 * that band, see globeViewShift).
 */
export function globeDistance(fovDeg: number, aspect: number, opts: Pick<FrameOptions, 'usableHeight'> = {}): number {
    const vHalf = ((fovDeg * Math.PI) / 180) / 2;
    const usable = Math.max(0.3, Math.min(1, opts.usableHeight ?? USABLE_HEIGHT));
    const vFit = Math.atan(Math.tan(vHalf) * usable);
    const hFit = Math.atan(Math.tan(vHalf) * aspect) * 0.94;
    return GLOBE_FIT / Math.sin(Math.min(vFit, hFit));
}

/** How far down (CSS px) to move the globe's centre so it sits mid-band rather than mid-screen. */
export function globeViewShift(viewportHeight: number, opts: Pick<FrameOptions, 'bandCenter'> = {}): number {
    return ((opts.bandCenter ?? 0) * viewportHeight) / 2;
}

/** Camera position `dist` from the globe's centre, looking at longitude/latitude (radians). */
export function globeCameraPosition(lon: number, lat: number, dist: number): [number, number, number] {
    const [x, y, z] = unitVector(lon, Math.sin(lat));
    return [x * dist, y * dist, z * dist];
}

export function globeFraming(fovDeg: number, aspect: number, opts: Pick<FrameOptions, 'usableHeight'> = {}): Framing {
    return { target: [0, 0, 0], position: globeCameraPosition(GLOBE_FRONT.lon, GLOBE_FRONT.lat, globeDistance(fovDeg, aspect, opts)) };
}
