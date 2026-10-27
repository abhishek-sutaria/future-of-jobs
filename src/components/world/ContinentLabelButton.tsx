import React, { useEffect, useRef } from 'react';
import { useWorldStore } from '../../worldStore';
import { CONTINENT_DISPLAY_NAMES } from '../../config/continents';
import { RegionLabel } from './WorldMarkers';
import { useWorldView } from './worldCamera';
import { worldPointer } from './worldPointer';

/**
 * A continent's name on the globe, as a real button: it opens its own field
 * (the same turn-then-zoom as tapping the land), whatever continent happens to
 * lie under it on screen. Hover or keyboard focus lights that continent's
 * coastline and keeps the globe still. On phones the hit area is at least
 * 44 px (.foj-globe-label-btn in index.css) without growing the chip, so the
 * collision layout still packs the visible names.
 */
export const ContinentLabelButton: React.FC<{
    code: string;
    expanded: boolean;
    onHover: (on: boolean) => void;
}> = ({ code, expanded, onHover }) => {
    const ref = useRef<HTMLButtonElement>(null);
    const enter = () => {
        worldPointer.hoverRegion = code;
        worldPointer.overLabel = true;
        worldPointer.lastInteraction = performance.now();
        onHover(true);
    };
    const leave = () => {
        if (worldPointer.hoverRegion === code) worldPointer.hoverRegion = null;
        worldPointer.overLabel = false;
        onHover(false);
    };
    const handlers = useRef({ enter, leave });
    useEffect(() => {
        handlers.current = { enter, leave };
    });
    // Native listeners: the label renders in drei's own React root, and React
    // drops onPointerEnter when the pointer arrives from a node another root
    // owns (the canvas), so hover never registered coming off the globe.
    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        const onEnter = () => handlers.current.enter();
        const onLeave = () => handlers.current.leave();
        el.addEventListener('pointerenter', onEnter);
        el.addEventListener('pointerleave', onLeave);
        return () => {
            el.removeEventListener('pointerenter', onEnter);
            el.removeEventListener('pointerleave', onLeave);
        };
    }, []);
    return (
        <button
            ref={ref}
            type="button"
            className="foj-globe-label-btn"
            data-continent={code}
            aria-label={`${CONTINENT_DISPLAY_NAMES[code]}: open this field`}
            onPointerDown={() => {
                worldPointer.interacted = true;
                worldPointer.lastInteraction = performance.now();
            }}
            onFocus={enter}
            onBlur={leave}
            onClick={() => {
                worldPointer.interacted = true;
                const view = useWorldView.getState();
                if (view.moving || view.view !== 'globe') return;
                useWorldStore.getState().focusContinent(code);
            }}
        >
            <RegionLabel code={code} expanded={expanded} />
        </button>
    );
};
