import React, { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { PointMaterial } from '@react-three/drei';
import * as THREE from 'three';
import { PARTICLES } from '../config/constants';
import { CHART_COLORS } from '../config/theme';

function getParticleCount(): number {
    const cores = navigator.hardwareConcurrency ?? 4;
    if (cores <= PARTICLES.CORE_THRESHOLDS.LOW) return PARTICLES.COUNTS.LOW;
    if (cores <= PARTICLES.CORE_THRESHOLDS.MEDIUM) return PARTICLES.COUNTS.MEDIUM;
    return PARTICLES.COUNTS.HIGH;
}

export const DataParticles: React.FC = () => {
    const count = useMemo(getParticleCount, []);
    const ref = useRef<THREE.Points>(null);

    const [positions, colors] = useMemo(() => {
        const p = new Float32Array(count * 3);
        const c = new Float32Array(count * 3);
        const colorPalette = [
            new THREE.Color('#38bdf8'),
            new THREE.Color('#ffffff'),
            new THREE.Color(CHART_COLORS.success),
            new THREE.Color(CHART_COLORS.danger),
        ];

        for (let i = 0; i < count; i++) {
            p[i * 3] = (Math.random() - 0.5) * PARTICLES.POSITION_SPREAD;
            p[i * 3 + 1] = Math.random() * (PARTICLES.MAX_HEIGHT - PARTICLES.MIN_HEIGHT) + PARTICLES.MIN_HEIGHT;
            p[i * 3 + 2] = (Math.random() - 0.5) * PARTICLES.POSITION_SPREAD;

            const col = colorPalette[Math.floor(Math.random() * colorPalette.length)];
            c[i * 3] = col.r;
            c[i * 3 + 1] = col.g;
            c[i * 3 + 2] = col.b;
        }
        return [p, c];
    }, [count]);

    useFrame((state) => {
        if (ref.current) {
            ref.current.rotation.y = state.clock.getElapsedTime() * PARTICLES.ROTATION_SPEED;
        }
    });

    return (
        <points ref={ref}>
            <bufferGeometry>
                <bufferAttribute
                    attach="attributes-position"
                    count={count}
                    array={positions}
                    itemSize={3}
                    args={[positions, 3]}
                />
                <bufferAttribute
                    attach="attributes-color"
                    count={count}
                    array={colors}
                    itemSize={3}
                    args={[colors, 3]}
                />
            </bufferGeometry>
            <PointMaterial
                transparent
                vertexColors
                size={PARTICLES.SIZE}
                sizeAttenuation={true}
                depthWrite={false}
                blending={THREE.AdditiveBlending}
            />
        </points>
    );
};
