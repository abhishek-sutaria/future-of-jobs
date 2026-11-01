import React, { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { DoubleSide, Matrix4, Quaternion, RingGeometry, SphereGeometry, Vector3, type InstancedMesh } from 'three';
import { useWorldStore } from '../../worldStore';
import { SCENE } from '../../config/constants';
import { surfaceHeight } from '../../utils/stageBake';
import { GROUND_Y } from './worldScene';
import { worldStage } from './worldStage';

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
 * are drawn from, so pins stay on them through the rise and the year slider.
 */
export const StagePins: React.FC = () => {
    const stage = useWorldStore((s) => s.drawnStage);
    const kelleyOnly = useWorldStore((s) => s.kelleyOnly);
    const rings = useRef<InstancedMesh>(null);
    const dots = useRef<InstancedMesh>(null);

    const jobs = useMemo(() => {
        if (!stage) return [];
        if (kelleyOnly) return stage.jobs.filter((j) => j.kelley);
        return stage.kind === 'field' ? stage.jobs : [];
    }, [stage, kelleyOnly]);

    const ringGeometry = useMemo(() => new RingGeometry(SCENE.ANCHOR.RING_INNER, SCENE.ANCHOR.RING_OUTER, SCENE.ANCHOR.RING_SEGMENTS), []);
    const dotGeometry = useMemo(() => new SphereGeometry(SCENE.ANCHOR.SPHERE_RADIUS, 12, 8), []);

    useFrame(() => {
        const bake = worldStage.bake;
        const ringMesh = rings.current;
        const dotMesh = dots.current;
        if (!ringMesh || !dotMesh) return;
        const show = !!bake && worldStage.rise > 0;
        ringMesh.visible = show;
        dotMesh.visible = show;
        if (!show) return;
        jobs.forEach((job, i) => {
            position.set(job.x, GROUND_Y + surfaceHeight(bake, job.x, job.z, worldStage.yearMix) * worldStage.rise, job.z);
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
                <meshBasicMaterial color="#ffffff" transparent opacity={0.6} side={DoubleSide} />
            </instancedMesh>
            <instancedMesh ref={dots} args={[dotGeometry, undefined, MAX_PINS]} frustumCulled={false} visible={false}>
                <meshBasicMaterial color="#ffffff" />
            </instancedMesh>
        </group>
    );
};
