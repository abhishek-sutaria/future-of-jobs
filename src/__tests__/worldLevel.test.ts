import { describe, it, expect } from 'vitest';
import { familyOf, SOC_FAMILIES } from '../config/socFamilies';
import { INDEX_CONTINENTS } from '../utils/occupationIndex';
import {
    breadcrumbs,
    clickAction,
    escapeGoesUp,
    familyLevel,
    familySummary,
    fieldLevel,
    isOnStage,
    levelAnnouncement,
    levelKind,
    levelUp,
    WORLD_LEVEL,
    ZOOM_OUT_RATIO,
    zoomedOutOfLevel,
    type ClickContext,
    type StageHit,
} from '../utils/worldLevel';

const FIELD = fieldLevel('51');
const FAMILY = familyLevel(5);
const NOTHING_OPEN = { panel: false, modal: false, picker: false };

describe('levels', () => {
    it('names each level from its two values', () => {
        expect(levelKind(WORLD_LEVEL)).toBe('world');
        expect(levelKind(FAMILY)).toBe('family');
        expect(levelKind(FIELD)).toBe('field');
    });

    it('takes every field\'s parent from the five-family data', () => {
        for (const c of INDEX_CONTINENTS) expect(fieldLevel(c.code)).toEqual({ focusedFamily: familyOf(c.code).id, focusedContinent: c.code });
    });

    it('goes up one level at a time: field, family, world, and stays there', () => {
        expect(levelUp(FIELD)).toEqual(FAMILY);
        expect(levelUp(FAMILY)).toEqual(WORLD_LEVEL);
        expect(levelUp(WORLD_LEVEL)).toEqual(WORLD_LEVEL);
    });

    it('from every field, one level up is that field\'s family', () => {
        for (const c of INDEX_CONTINENTS) expect(levelUp(fieldLevel(c.code))).toEqual(familyLevel(familyOf(c.code).id));
    });
});

describe('what is on stage', () => {
    const codes = INDEX_CONTINENTS.map((c) => c.code);

    it('is everything at the world', () => {
        expect(codes.filter((c) => isOnStage(WORLD_LEVEL, c))).toHaveLength(22);
    });

    it('is exactly the family\'s fields at a family', () => {
        for (const f of SOC_FAMILIES) {
            expect(codes.filter((c) => isOnStage(familyLevel(f.id), c))).toEqual(codes.filter((c) => familyOf(c).id === f.id));
        }
    });

    it('is the one field at a field', () => {
        for (const code of codes) expect(codes.filter((c) => isOnStage(fieldLevel(code), c))).toEqual([code]);
    });
});

describe('breadcrumbs', () => {
    it('has none at the world, which has nothing above it', () => {
        expect(breadcrumbs(WORLD_LEVEL)).toEqual([]);
    });

    it('reads All families › family, with the family as the current level', () => {
        const crumbs = breadcrumbs(FAMILY);
        expect(crumbs.map((c) => c.label)).toEqual(['All families', 'Production, Transportation & Moving']);
        expect(crumbs.map((c) => c.current)).toEqual([false, true]);
    });

    it('reads All families › family › field, and each crumb goes straight to its level', () => {
        const crumbs = breadcrumbs(FIELD);
        expect(crumbs.map((c) => c.label)).toEqual(['All families', 'Production, Transportation & Moving', 'Production']);
        expect(crumbs.map((c) => c.current)).toEqual([false, false, true]);
        expect(crumbs[0].level).toEqual(WORLD_LEVEL);
        expect(crumbs[1].level).toEqual(FAMILY);
    });
});

describe('announcements', () => {
    it('says a different sentence for every level', () => {
        const said = [
            levelAnnouncement(WORLD_LEVEL, false),
            levelAnnouncement(WORLD_LEVEL, true),
            levelAnnouncement(FAMILY, true),
            levelAnnouncement(FIELD, true),
        ];
        expect(new Set(said).size).toBe(4);
    });

    it('names the family and the field', () => {
        expect(levelAnnouncement(FAMILY, true)).toContain('Production, Transportation & Moving family, 2 fields');
        expect(levelAnnouncement(FIELD, true)).toContain('Production field, in Production, Transportation & Moving');
    });
});

describe('family info line', () => {
    // Summed here straight from the published rows, field by field.
    it.each(SOC_FAMILIES.map((f) => [f.shortName, f] as const))('%s is the plain sum of its fields', (_name, family) => {
        const fields = INDEX_CONTINENTS.filter((c) => Number(c.code) >= Number(family.majors[0]) && Number(c.code) <= Number(family.majors[1]));
        let workers = 0;
        let occupations = 0;
        for (const c of fields) {
            workers += c.ep.employment2025;
            occupations += c.occupationCount;
        }
        expect(familySummary(family.id)).toEqual({ workers, fields: fields.length, occupations });
    });

    it('accounts for every field, occupation and worker exactly once', () => {
        const all = SOC_FAMILIES.map((f) => familySummary(f.id));
        expect(all.reduce((n, s) => n + s.fields, 0)).toBe(22);
        expect(all.reduce((n, s) => n + s.occupations, 0)).toBe(INDEX_CONTINENTS.reduce((n, c) => n + c.occupationCount, 0));
        expect(all.reduce((n, s) => n + s.workers, 0)).toBe(INDEX_CONTINENTS.reduce((n, c) => n + c.ep.employment2025, 0));
    });

    it('carries no growth figure', () => {
        expect(Object.keys(familySummary(1)).sort()).toEqual(['fields', 'occupations', 'workers']);
    });
});

describe('the zoom-out rule', () => {
    const FRAMING = 40;
    const past = FRAMING * ZOOM_OUT_RATIO + 0.01;

    it('is about 1.25 times the framing distance', () => {
        expect(ZOOM_OUT_RATIO).toBe(1.25);
    });

    it('fires just past the ratio from a family and from a field', () => {
        expect(zoomedOutOfLevel('family', past, FRAMING, false, true)).toBe(true);
        expect(zoomedOutOfLevel('field', past, FRAMING, false, true)).toBe(true);
    });

    it('does not fire at the ratio or closer', () => {
        expect(zoomedOutOfLevel('field', FRAMING * ZOOM_OUT_RATIO, FRAMING, false, true)).toBe(false);
        expect(zoomedOutOfLevel('field', FRAMING, FRAMING, false, true)).toBe(false);
        expect(zoomedOutOfLevel('field', FRAMING / 3, FRAMING, false, true)).toBe(false);
    });

    it('never fires during a flight, which starts far out', () => {
        expect(zoomedOutOfLevel('field', FRAMING * 5, FRAMING, true, true)).toBe(false);
    });

    it('waits for the camera to settle, so a coasting scroll cannot climb a second level', () => {
        expect(zoomedOutOfLevel('family', past, FRAMING, false, false)).toBe(false);
    });

    it('has nothing to leave at the world', () => {
        expect(zoomedOutOfLevel('world', FRAMING * 5, FRAMING, false, true)).toBe(false);
    });

    it('cannot loop: each level up lands on a framing that no longer trips it, and stops at the world', () => {
        let level = FIELD;
        const framing = { field: 30, family: 60, world: 80 };
        let climbs = 0;
        for (let frame = 0; frame < 100; frame++) {
            const kind = levelKind(level);
            // The camera always lands on the level's framing distance.
            if (zoomedOutOfLevel(kind, framing[kind], framing[kind], false, true)) {
                level = levelUp(level);
                climbs++;
            }
        }
        expect(climbs).toBe(0);
        expect(level).toEqual(FIELD);
    });
});

describe('Esc', () => {
    it('goes up from a family and from a field', () => {
        expect(escapeGoesUp(FIELD, NOTHING_OPEN)).toBe(true);
        expect(escapeGoesUp(FAMILY, NOTHING_OPEN)).toBe(true);
    });

    it('has nothing to do at the world', () => {
        expect(escapeGoesUp(WORLD_LEVEL, NOTHING_OPEN)).toBe(false);
    });

    it('leaves a job panel, a modal or the picker to their own Esc', () => {
        expect(escapeGoesUp(FIELD, { ...NOTHING_OPEN, panel: true })).toBe(false);
        expect(escapeGoesUp(FIELD, { ...NOTHING_OPEN, modal: true })).toBe(false);
        expect(escapeGoesUp(FIELD, { ...NOTHING_OPEN, picker: true })).toBe(false);
    });
});

describe('click rules', () => {
    const MISS: StageHit = { label: null, peak: null, ground: null };
    const CTX: ClickContext = { fieldNames: true, touch: false, tappedKey: null, labelledKeys: new Set() };
    const BROAD: ClickContext = { ...CTX, fieldNames: false };

    describe('world, broad', () => {
        it('a family name opens that family', () => {
            expect(clickAction(WORLD_LEVEL, { ...MISS, label: { kind: 'family', id: 3 } }, BROAD)).toEqual({ kind: 'family', id: 3 });
        });

        it('anywhere on a family\'s block opens that family, for every field in it', () => {
            for (const c of INDEX_CONTINENTS) {
                expect(clickAction(WORLD_LEVEL, { ...MISS, ground: c.code }, BROAD)).toEqual({ kind: 'family', id: familyOf(c.code).id });
            }
        });

        it('off the map does nothing', () => {
            expect(clickAction(WORLD_LEVEL, MISS, BROAD)).toBeNull();
        });
    });

    describe('world, zoomed in with field names showing', () => {
        it('a field name or its ground opens that field', () => {
            expect(clickAction(WORLD_LEVEL, { ...MISS, label: { kind: 'field', code: '41' } }, CTX)).toEqual({ kind: 'field', code: '41' });
            expect(clickAction(WORLD_LEVEL, { ...MISS, ground: '41' }, CTX)).toEqual({ kind: 'field', code: '41' });
        });

        it('a Kelley peak opens its role', () => {
            const peak = { key: 'k', code: '13' };
            expect(clickAction(WORLD_LEVEL, { ...MISS, peak }, CTX)).toEqual({ kind: 'role', key: 'k' });
        });
    });

    describe('family', () => {
        it('a field name, its ground or one of its hills opens that field', () => {
            expect(clickAction(FAMILY, { ...MISS, label: { kind: 'field', code: '53' } }, CTX)).toEqual({ kind: 'field', code: '53' });
            expect(clickAction(FAMILY, { ...MISS, ground: '53' }, CTX)).toEqual({ kind: 'field', code: '53' });
            expect(clickAction(FAMILY, { ...MISS, peak: { key: 'p', code: '53' } }, CTX)).toEqual({ kind: 'field', code: '53' });
        });

        it('a tap on a peak opens the field too, rather than needing two', () => {
            expect(clickAction(FAMILY, { ...MISS, peak: { key: 'p', code: '53' } }, { ...CTX, touch: true })).toEqual({ kind: 'field', code: '53' });
        });

        it('never opens a job: anything job-shaped there leads to its field', () => {
            const kelley = { ...CTX, labelledKeys: new Set(['k']) };
            expect(clickAction(FAMILY, { ...MISS, label: { kind: 'peak', key: 'k', code: '53' } }, kelley)).toEqual({ kind: 'field', code: '53' });
            expect(clickAction(FAMILY, { ...MISS, label: { kind: 'peak', key: 'h', code: '53' } }, CTX)).toEqual({ kind: 'field', code: '53' });
        });

        it('the empty area around the block does nothing', () => {
            expect(clickAction(FAMILY, MISS, CTX)).toBeNull();
            expect(clickAction(FAMILY, { ...MISS, ground: '11' }, CTX)).toBeNull();
        });

        it('nothing off stage can be hit, whatever was under the pointer', () => {
            expect(clickAction(FAMILY, { ...MISS, label: { kind: 'field', code: '11' } }, CTX)).toBeNull();
            expect(clickAction(FAMILY, { ...MISS, label: { kind: 'peak', key: 'k', code: '11' } }, CTX)).toBeNull();
            expect(clickAction(FAMILY, { ...MISS, label: { kind: 'family', id: 1 } }, CTX)).toBeNull();
            expect(clickAction(FAMILY, { ...MISS, peak: { key: 'p', code: '11' } }, CTX)).toBeNull();
        });
    });

    describe('field', () => {
        const peak = { key: 'p', code: '51' };

        it('a click on a peak opens its role, as it always has', () => {
            expect(clickAction(FIELD, { ...MISS, peak }, CTX)).toEqual({ kind: 'role', key: 'p' });
        });

        it('on touch the first tap names an unlabelled peak and the second opens it', () => {
            const touch = { ...CTX, touch: true };
            expect(clickAction(FIELD, { ...MISS, peak }, touch)).toEqual({ kind: 'reveal', key: 'p' });
            expect(clickAction(FIELD, { ...MISS, peak }, { ...touch, tappedKey: 'p' })).toEqual({ kind: 'role', key: 'p' });
        });

        it('on touch a labelled peak opens on the first tap', () => {
            expect(clickAction(FIELD, { ...MISS, peak }, { ...CTX, touch: true, labelledKeys: new Set(['p']) })).toEqual({ kind: 'role', key: 'p' });
        });

        it('its own ground and the empty area do nothing', () => {
            expect(clickAction(FIELD, { ...MISS, ground: '51' }, CTX)).toBeNull();
            expect(clickAction(FIELD, MISS, CTX)).toBeNull();
        });

        it('its neighbour in the same family is off stage too', () => {
            expect(clickAction(FIELD, { ...MISS, ground: '53' }, CTX)).toBeNull();
            expect(clickAction(FIELD, { ...MISS, peak: { key: 'q', code: '53' } }, CTX)).toBeNull();
            expect(clickAction(FIELD, { ...MISS, label: { kind: 'field', code: '53' } }, CTX)).toBeNull();
        });
    });
});
