/**
 * Moving between the world, a family and a field through the world store, and
 * the family button itself. The rules are in worldLevel.test.ts, the camera
 * side in stageFraming.test.ts, the breadcrumb and Esc in worldBar.test.tsx.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import { FamilyLabel } from '../components/world/WorldMarkers';
import { useStore } from '../store';
import { useWorldStore } from '../worldStore';
import { buildWorldScene } from '../components/world/worldScene';
import { BROAD_LABELS, FAMILY_LEVEL_LABELS, FIELD_LABELS, FIELD_LEVEL_LABELS } from '../utils/labelLevel';
import { getRoleEntries } from '../utils/roles';
import { familyLevel, fieldLevel, WORLD_LEVEL } from '../utils/worldLevel';

const scene = buildWorldScene(useStore.getState().jobs);
const entries = getRoleEntries(useStore.getState().jobs);
const level = () => {
    const { focusedFamily, focusedContinent } = useWorldStore.getState();
    return { focusedFamily, focusedContinent };
};

beforeEach(() => {
    useStore.getState().setSelectedJob(null);
    useWorldStore.setState({ ...WORLD_LEVEL, focusRequestId: 0, kelleyZoom: false, labels: BROAD_LABELS, kelleyOnly: false, selectedOccupationSoc: null });
});

describe('going in', () => {
    it('a family shows its field names, leaves no field open, and asks for a flight', () => {
        useWorldStore.getState().focusContinent('51');
        useWorldStore.getState().focusFamily(3);
        const s = useWorldStore.getState();
        expect(level()).toEqual(familyLevel(3));
        expect(s.labels).toBe(FAMILY_LEVEL_LABELS);
        expect(s.focusRequestId).toBe(2);
    });

    it('a field brings its family with it', () => {
        useWorldStore.getState().focusContinent('41');
        expect(level()).toEqual(fieldLevel('41'));
        expect(useWorldStore.getState().labels).toBe(FIELD_LEVEL_LABELS);
    });

    it('asking for the same level again re-frames it', () => {
        useWorldStore.getState().focusFamily(2);
        useWorldStore.getState().focusFamily(2);
        expect(useWorldStore.getState().focusRequestId).toBe(2);
    });
});

describe('going back', () => {
    it('up one level at a time, ending at the world', () => {
        const { focusContinent, goUp } = useWorldStore.getState();
        focusContinent('51');
        goUp();
        expect(level()).toEqual(familyLevel(5));
        goUp();
        expect(level()).toEqual(WORLD_LEVEL);
    });

    it('does nothing at the world: no flight, no change', () => {
        useWorldStore.getState().goUp();
        expect(useWorldStore.getState().focusRequestId).toBe(0);
    });

    it('a crumb goes straight to its level, skipping any in between', () => {
        useWorldStore.getState().focusContinent('51');
        useWorldStore.getState().goToLevel(WORLD_LEVEL);
        expect(level()).toEqual(WORLD_LEVEL);
        expect(useWorldStore.getState().labels).toBe(BROAD_LABELS);
    });

    it('Reset clears the family and the field without asking for a flight: it moves the camera itself', () => {
        useWorldStore.getState().focusContinent('51');
        const before = useWorldStore.getState().focusRequestId;
        useWorldStore.getState().resetLevel();
        const s = useWorldStore.getState();
        expect(level()).toEqual(WORLD_LEVEL);
        expect(s.labels).toBe(BROAD_LABELS);
        expect(s.focusRequestId).toBe(before);
    });

    it('from a family, the picker and search both land on that field\'s family on the way back', () => {
        useWorldStore.getState().focusFamily(1);
        useWorldStore.getState().focusContinent('47');
        useWorldStore.getState().goUp();
        expect(level()).toEqual(familyLevel(4));
    });
});

describe('search', () => {
    it('opens the field and the panel, and going back lands on the family', () => {
        const entry = entries.find((e) => e.kind === 'bls' && e.continent === '47')!;
        useWorldStore.getState().openRole(entry);
        expect(level()).toEqual(fieldLevel('47'));
        expect(useWorldStore.getState().selectedOccupationSoc).toBe(entry.soc);
        useWorldStore.getState().closeOccupation();
        expect(level()).toEqual(fieldLevel('47'));
        useWorldStore.getState().goUp();
        expect(level()).toEqual(familyLevel(4));
    });

    it('a Kelley role does the same, and closing its panel stays in the field', () => {
        const entry = entries.find((e) => e.kind === 'kelley')!;
        useWorldStore.getState().openRole(entry);
        expect(useStore.getState().selectedJob?.id).toBe(entry.jobId);
        useStore.getState().setSelectedJob(null);
        expect(level()).toEqual(fieldLevel(entry.continent));
    });
});

describe('Kelley toggle', () => {
    it('zooms in from the broad view, where job labels never show', () => {
        useWorldStore.getState().setKelleyOnly(true);
        const s = useWorldStore.getState();
        expect(s.kelleyZoom).toBe(true);
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

    it.each([['family', () => useWorldStore.getState().focusFamily(1)], ['field', () => useWorldStore.getState().focusContinent('13')]] as const)(
        'never moves the camera at a %s',
        (_name, open) => {
            open();
            const before = useWorldStore.getState().focusRequestId;
            useWorldStore.getState().setKelleyOnly(true);
            useWorldStore.getState().setKelleyOnly(false);
            useWorldStore.getState().setKelleyOnly(true);
            expect(useWorldStore.getState().focusRequestId).toBe(before);
            expect(useWorldStore.getState().kelleyZoom).toBe(false);
        },
    );

    it('going home with it on lands where its job labels show', () => {
        useWorldStore.getState().focusFamily(1);
        useWorldStore.getState().setKelleyOnly(true);
        useWorldStore.getState().goUp();
        const s = useWorldStore.getState();
        expect(s.kelleyZoom).toBe(true);
        expect(s.labels).toBe(FIELD_LABELS);
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
        expect(b.getAttribute('aria-label')).toBe('Production, Transportation & Moving: open this family');
        expect(b.textContent).toBe('Production, Transportation & Moving');
        expect(b.getAttribute('tabindex')).toBe('0');
    });

    it('cannot take focus while it fades out', () => {
        expect(render(true).getAttribute('tabindex')).toBe('-1');
    });
});
