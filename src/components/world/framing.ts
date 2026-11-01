import { SCENE } from '../../config/constants';
import { rectDepth, rectWidth, WORLD_BOUNDS, type Rect } from '../../utils/worldLayout';
import { GROUND_Y } from './worldScene';

export interface Framing {
    target: [number, number, number];
    position: [number, number, number];
}

export interface FreeBand {
    /** Top of the band free of chrome, as a share of the viewport height from the top. */
    top: number;
    /** Bottom of that band, on the same scale. */
    bottom: number;
    /** Top-left corner of the legend, where it rises into the band at the bottom right: width and height shares of the viewport. */
    legend?: { left: number; top: number };
}

/** A point the framing must keep inside the free band, such as a peak's tip. */
export type StagePoint = readonly [x: number, y: number, z: number];

/** Share of the viewport height left for the terrain between the header and the year slider. */
const USABLE_HEIGHT = 0.68;
/** Used only until the page has chrome to measure. */
const DEFAULT_BAND: FreeBand = { top: 0.16, bottom: 0.84 };

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

/** Camera elevation when framing a family or field, from the horizontal. */
const BLOCK_ELEVATION_DEG = 58;
/** The most of the free band's height a block may fill, so it never touches the chrome. */
const MAX_BAND_FILL = 0.94;
/** The most of the screen's width a block may fill, leaving its soft edge on screen. */
const MAX_WIDTH_FILL = 0.92;

/**
 * The closest framing that puts a block of the ground centred on the screen
 * and in the free band, with `tips` inside the band too.
 *
 * The block's far and near edges are placed exactly, not estimated: at a share
 * `fill` of the band they should land at known screen heights, and two rays
 * through those heights cross the ground the block's depth apart at one camera
 * height only. Perspective makes the block a trapezoid, so its middle is not
 * the middle of its image; working from the edges centres what is actually
 * seen. `fill` then only has to shrink until the width, the tips, the legend
 * and the closest allowed camera distance are all satisfied.
 */
export function frameBlock(rect: Rect, fovDeg: number, aspect: number, band: FreeBand = DEFAULT_BAND, tips: readonly StagePoint[] = []): Framing {
    const elevation = (BLOCK_ELEVATION_DEG * Math.PI) / 180;
    const tanV = Math.tan(((fovDeg * Math.PI) / 180) / 2);
    const [sinE, cosE] = [Math.sin(elevation), Math.cos(elevation)];
    const bandTop = 1 - 2 * band.top;
    const bandBottom = 1 - 2 * band.bottom;
    const middle = (bandTop + bandBottom) / 2;
    const half = (bandTop - bandBottom) / 2;
    const legend = band.legend && { x: 2 * band.legend.left - 1, y: 1 - 2 * band.legend.top };
    const cx = (rect.x0 + rect.x1) / 2;
    const groundRun = (ndcY: number) => 1 / Math.tan(elevation - Math.atan(ndcY * tanV));

    const cameraAt = (fill: number) => {
        const farRun = groundRun(middle + half * fill);
        const height = rectDepth(rect) / (farRun - groundRun(middle - half * fill));
        return { height, z: rect.z0 + height * farRun };
    };
    // Depth along the line of sight, and the screen position, of a world point.
    const project = (camera: { height: number; z: number }, x: number, y: number, z: number) => {
        const dy = y - (GROUND_Y + camera.height);
        const dz = z - camera.z;
        const depth = -dy * sinE - dz * cosE;
        return { ndcX: (x - cx) / (depth * tanV * aspect), ndcY: (dy * cosE - dz * sinE) / (depth * tanV) };
    };
    // How far along the line of sight the ground is, which is the orbit distance.
    const orbitDistance = (camera: { height: number }) => (camera.height - 1) / sinE;
    const fits = (fill: number) => {
        const camera = cameraAt(fill);
        if (orbitDistance(camera) < SCENE.MIN_CAMERA_DISTANCE + 4) return false;
        const corner = project(camera, rect.x1, GROUND_Y, rect.z1);
        if (corner.ndcX > MAX_WIDTH_FILL) return false;
        if (legend && corner.ndcX > legend.x && corner.ndcY < legend.y) return false;
        return tips.every(([x, y, z]) => {
            const p = project(camera, x, y, z);
            return p.ndcY <= bandTop && Math.abs(p.ndcX) <= 1;
        });
    };

    let fill = MAX_BAND_FILL;
    if (!fits(fill)) {
        let low = 0;
        for (let i = 0; i < 40; i++) {
            const mid = (low + fill) / 2;
            if (fits(mid)) low = mid;
            else fill = mid;
        }
        fill = low;
    }

    const camera = cameraAt(fill);
    const distance = orbitDistance(camera);
    const position: [number, number, number] = [cx, GROUND_Y + camera.height, camera.z];
    return { position, target: [cx, position[1] - distance * sinE, camera.z - distance * cosE] };
}

/** A field's framing: `tips` are its peaks' tips on its own height scale. */
export function regionFraming(rect: Rect, fovDeg: number, aspect: number, band?: FreeBand, tips?: readonly StagePoint[]): Framing {
    return frameBlock(rect, fovDeg, aspect, band, tips);
}

/** A family's framing: `tips` are its peaks' tips on the national height scale. */
export function familyFraming(rect: Rect, fovDeg: number, aspect: number, band?: FreeBand, tips?: readonly StagePoint[]): Framing {
    return frameBlock(rect, fovDeg, aspect, band, tips);
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
