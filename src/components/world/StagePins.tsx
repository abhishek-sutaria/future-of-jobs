import React, { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { DoubleSide, Matrix4, Quaternion, RingGeometry, SphereGeometry, Vector3, type InstancedMesh, type MeshBasicMaterial } from 'three';
import { highlightOn, isHighlighted } from '../../utils/iuSchools';
import { useWorldStore } from '../../worldStore';
import { SCENE } from '../../config/constants';
import { surfaceHeight } from '../../utils/stageBake';
import { mapX, mapZ } from '../../utils/stageMap';
import { GROUND_Y } from './worldScene';
import { layerOf, stageToDisplay, worldView } from './worldView';

/** The rings' opacity on a field at rest; they fade with the field's surface. */
const RING_OPACITY = 0.6;

/** Most jobs on any stage, with room to spare: Management family has 378. */
const MAX_PINS = 400;

const matrix = new Matrix4();
const position = new Vector3();
const unit = new Vector3(1, 1, 1);
const upright = new Quaternion();
const flat = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2);

/**
 * The live view's anchors, a white ring and dot where each job stands on the
 * surface, in two draw calls. Heights come from the same baked surface the hills
 * are drawn from, through the same map, so pins stay on them through a flight
 * and the year slider.
 */
export const StagePins: React.FC = () => {
    const stage = useWorldStore((s) => s.drawnStage);
    const kelleyOnly = useWorldStore((s) => s.kelleyOnly);
    const school = useWorldStore((s) => s.school);
    const rings = useRef<InstancedMesh>(null);
    const dots = useRef<InstancedMesh>(null);

    const jobs = useMemo(() => {
        if (stage?.kind !== 'field') return [];
        const highlight = { kelleyOnly, school };
        return highlightOn(highlight) ? stage.jobs.filter((j) => isHighlighted(highlight, { kind: j.kelley ? 'kelley' : 'bls', soc: j.soc })) : stage.jobs;
    }, [stage, kelleyOnly, school]);

    const ringGeometry = useMemo(() => new RingGeometry(SCENE.ANCHOR.RING_INNER, SCENE.ANCHOR.RING_OUTER, SCENE.ANCHOR.RING_SEGMENTS), []);
    const dotGeometry = useMemo(() => new SphereGeometry(SCENE.ANCHOR.SPHERE_RADIUS, 12, 8), []);

    useFrame(() => {
        const ringMesh = rings.current;
        const dotMesh = dots.current;
        if (!ringMesh || !dotMesh) return;
        const surface = stage ? worldView.surfaces.get(stage.key) : undefined;
        const layer = stage ? layerOf(stage.key) : null;
        const show = !!stage && !!surface && !!layer && layer.alpha > 0;
        ringMesh.visible = show;
        dotMesh.visible = show;
        if (!show) return;
        const { bake } = surface;
        const toScreen = stageToDisplay(stage);
        (ringMesh.material as MeshBasicMaterial).opacity = RING_OPACITY * layer.alpha;
        (dotMesh.material as MeshBasicMaterial).opacity = layer.alpha;
        jobs.forEach((job, i) => {
            position.set(mapX(toScreen, job.x), GROUND_Y + surfaceHeight(bake, job.x, job.z, worldView.yearMix) * layer.mult, mapZ(toScreen, job.z));
            ringMesh.setMatrixAt(i, matrix.compose(position, flat, unit));
            dotMesh.setMatrixAt(i, matrix.compose(position, upright, unit));
        });
        ringMesh.count = jobs.length;
        dotMesh.count = jobs.length;
        ringMesh.instanceMatrix.needsUpdate = true;
        dotMesh.instanceMatrix.needsUpdate = true;
    });

    return (
        <group>
            <instancedMesh ref={rings} args={[ringGeometry, undefined, MAX_PINS]} frustumCulled={false} visible={false}>
                <meshBasicMaterial color="#ffffff" transparent opacity={RING_OPACITY} side={DoubleSide} />
            </instancedMesh>
            <instancedMesh ref={dots} args={[dotGeometry, undefined, MAX_PINS]} frustumCulled={false} visible={false}>
                <meshBasicMaterial color="#ffffff" transparent />
            </instancedMesh>
        </group>
    );
};
