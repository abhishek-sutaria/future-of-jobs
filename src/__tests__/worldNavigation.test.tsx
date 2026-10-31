/**
 * The ways in and out of the zoomed-in labels that live in the world store,
 * and the family button itself. The camera side is in worldLabels.test.ts.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import { FamilyLabel } from '../components/world/WorldMarkers';
import { useStore } from '../store';
import { useWorldStore } from '../worldStore';
import { buildWorldScene } from '../components/world/worldScene';
import { BROAD_LABELS, FIELD_LABELS } from '../utils/labelLevel';

const scene = buildWorldScene(useStore.getState().jobs);

beforeEach(() => {
    useWorldStore.setState({ focusedContinent: null, focusRequestId: 0, flyTo: null, labels: BROAD_LABELS, kelleyOnly: false });
});

describe('family flights', () => {
    it('asks for a flight to the family and leaves no field zoomed', () => {
        useWorldStore.setState({ focusedContinent: '51' });
        useWorldStore.getState().focusFamily(3);
        const s = useWorldStore.getState();
        expect(s.flyTo).toEqual({ kind: 'family', id: 3 });
        expect(s.focusedContinent).toBeNull();
        expect(s.focusRequestId).toBe(1);
    });

    it('a later field flight replaces it', () => {
        useWorldStore.getState().focusFamily(3);
        useWorldStore.getState().focusContinent('41');
        expect(useWorldStore.getState().flyTo).toBeNull();
    });
});

describe('Kelley toggle', () => {
    it('zooms in from the broad view, where job labels never show', () => {
        useWorldStore.getState().setKelleyOnly(true);
        const s = useWorldStore.getState();
        expect(s.flyTo).toEqual({ kind: 'fields' });
        expect(s.focusRequestId).toBe(1);
    });

    it('leaves the camera alone when the field names are already showing', () => {
        useWorldStore.setState({ labels: FIELD_LABELS });
        useWorldStore.getState().setKelleyOnly(true);
        useWorldStore.getState().setKelleyOnly(false);
        expect(useWorldStore.getState().focusRequestId).toBe(0);
    });

    it('turning it off at the broad view does not fly anywhere', () => {
        useWorldStore.setState({ kelleyOnly: true });
        useWorldStore.getState().setKelleyOnly(false);
        const s = useWorldStore.getState();
        expect(s.kelleyOnly).toBe(false);
        expect(s.focusRequestId).toBe(0);
    });
});

describe('FamilyLabel', () => {
    const family = scene.layout.families.find((f) => f.family.id === 5)!;
    const render = (leaving: boolean) => {
        const html = renderToStaticMarkup(<FamilyLabel family={family} highlighted={false} leaving={leaving} />);
        return new JSDOM(html).window.document.querySelector('button')!;
    };

    it('is a real button that says what it does', () => {
        const b = render(false);
        expect(b.getAttribute('type')).toBe('button');
        expect(b.getAttribute('aria-label')).toBe('Production, Transportation & Moving: zoom in to this family');
        expect(b.textContent).toBe('Production, Transportation & Moving');
        expect(b.getAttribute('tabindex')).toBe('0');
    });

    it('cannot take focus while it fades out', () => {
        expect(render(true).getAttribute('tabindex')).toBe('-1');
    });
});
