// @vitest-environment jsdom
/**
 * The way back up: the breadcrumb, Back, Esc, what the level's info line says
 * and where keyboard focus goes when a button disappears. Mounts the real
 * WorldBar. Level rules themselves are in worldLevel.test.ts.
 */

import { describe, it, expect, vi, beforeAll, afterAll, afterEach, beforeEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { WorldBar, Breadcrumb } from '../components/WorldBar';
import { useStore } from '../store';
import { useWorldStore } from '../worldStore';
import { BROAD_LABELS } from '../utils/labelLevel';
import { breadcrumbs, familyLevel, familySummary, fieldLevel, WORLD_LEVEL } from '../utils/worldLevel';
import { formatCount } from '../utils/roleFormat';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLDivElement;

const level = () => {
    const { focusedFamily, focusedContinent } = useWorldStore.getState();
    return { focusedFamily, focusedContinent };
};
const go = (action: () => void) => act(async () => action());
const press = (init: KeyboardEventInit = {}, target: EventTarget = document.body) =>
    act(async () => { target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, ...init })); });
const buttonNamed = (name: string) => [...container.querySelectorAll('button')].find((b) => b.textContent?.trim() === name);
const crumbs = () => container.querySelector('[data-breadcrumb]');
const live = () => container.querySelector('[aria-live]')!.textContent;

beforeAll(() => {
    window.matchMedia ??= ((query: string) => ({
        matches: false, media: query, onchange: null,
        addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {},
        dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
});

beforeEach(async () => {
    useStore.getState().setSelectedJob(null);
    useWorldStore.setState({ ...WORLD_LEVEL, focusRequestId: 0, kelleyZoom: false, labels: BROAD_LABELS, kelleyOnly: false, selectedOccupationSoc: null });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root.render(<WorldBar />));
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body.innerHTML = '';
});

afterAll(() => vi.restoreAllMocks());

describe('breadcrumb', () => {
    it('is not there at the world, and neither is any old "All fields" button', async () => {
        expect(crumbs()).toBeNull();
        expect(container.textContent).not.toContain('← All fields');
        await go(() => useWorldStore.getState().focusFamily(5));
        expect(container.textContent).not.toContain('← All fields');
    });

    it('at a family: All families is a button and the family is plain text', async () => {
        await go(() => useWorldStore.getState().focusFamily(5));
        expect(buttonNamed('All families')).toBeDefined();
        expect(buttonNamed('Production, Transportation & Moving')).toBeUndefined();
        expect(crumbs()!.querySelector('[aria-current="location"]')!.textContent).toBe('Production, Transportation & Moving');
    });

    it('at a field: both levels above are buttons and the field is plain text', async () => {
        await go(() => useWorldStore.getState().focusContinent('51'));
        expect(buttonNamed('All families')).toBeDefined();
        expect(buttonNamed('Production, Transportation & Moving')).toBeDefined();
        const current = crumbs()!.querySelector('[aria-current="location"]')!;
        expect(current.textContent).toBe('Production');
        expect(current.tagName).toBe('SPAN');
    });

    it('the family crumb goes to the family', async () => {
        await go(() => useWorldStore.getState().focusContinent('51'));
        await act(async () => buttonNamed('Production, Transportation & Moving')!.click());
        expect(level()).toEqual(familyLevel(5));
    });

    it('the All families crumb goes straight to the world, from a field', async () => {
        await go(() => useWorldStore.getState().focusContinent('51'));
        await act(async () => buttonNamed('All families')!.click());
        expect(level()).toEqual(WORLD_LEVEL);
    });

    it('Back goes up one level, twice over', async () => {
        await go(() => useWorldStore.getState().focusContinent('51'));
        await act(async () => buttonNamed('← Back')!.click());
        expect(level()).toEqual(familyLevel(5));
        await act(async () => buttonNamed('← Back')!.click());
        expect(level()).toEqual(WORLD_LEVEL);
    });
});

describe('when the trail does not fit', () => {
    afterEach(() => vi.restoreAllMocks());

    const renderAt = async (trailWidth: number) => {
        vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement) {
            return this.hasAttribute('aria-hidden') ? trailWidth : 70;
        });
        vi.spyOn(Element.prototype, 'clientWidth', 'get').mockReturnValue(358);
        await act(async () => root.render(
            <Breadcrumb crumbs={breadcrumbs(fieldLevel('51'))} onGo={() => {}} onBack={() => {}} />,
        ));
    };

    it('keeps the full trail while it fits', async () => {
        await renderAt(200);
        expect(buttonNamed('All families')).toBeDefined();
    });

    it('falls back to Back plus the current name', async () => {
        await renderAt(420);
        expect(buttonNamed('All families')).toBeUndefined();
        expect(buttonNamed('← Back')).toBeDefined();
        expect(crumbs()!.querySelector('[aria-current="location"]')!.textContent).toBe('Production');
    });
});

describe('Esc', () => {
    beforeEach(() => go(() => useWorldStore.getState().focusContinent('51')));

    it('goes up one level per press', async () => {
        await press();
        expect(level()).toEqual(familyLevel(5));
        await press();
        expect(level()).toEqual(WORLD_LEVEL);
    });

    it('does not cascade while the key is held', async () => {
        await press();
        await press({ repeat: true });
        expect(level()).toEqual(familyLevel(5));
    });

    it('does nothing at the world', async () => {
        await go(() => useWorldStore.getState().goToLevel(WORLD_LEVEL));
        const before = useWorldStore.getState().focusRequestId;
        await press();
        expect(useWorldStore.getState().focusRequestId).toBe(before);
    });

    it('leaves an open job panel to its own Esc, even though that closes it on this same key press', async () => {
        const job = useStore.getState().jobs[0];
        await go(() => useStore.getState().setSelectedJob(job));
        // What JobDetailPanel does: closes itself from a bubbling listener.
        const closePanel = () => useStore.getState().setSelectedJob(null);
        window.addEventListener('keydown', closePanel);
        await press();
        window.removeEventListener('keydown', closePanel);
        expect(useStore.getState().selectedJob).toBeNull();
        expect(level()).toEqual(fieldLevel('51'));
    });

    it('leaves an open unscored panel alone', async () => {
        await go(() => useWorldStore.setState({ selectedOccupationSoc: '51-1011' }));
        await press();
        expect(level()).toEqual(fieldLevel('51'));
    });

    it('leaves an open modal alone', async () => {
        const dialog = document.body.appendChild(document.createElement('div'));
        dialog.setAttribute('aria-modal', 'true');
        await press();
        dialog.remove();
        expect(level()).toEqual(fieldLevel('51'));
    });

    it('with the picker open, closes the picker and stays at this level', async () => {
        await act(async () => container.querySelector<HTMLElement>('[data-field-picker]')!.click());
        expect(container.querySelector('[role="listbox"]')).not.toBeNull();
        await press();
        expect(container.querySelector('[role="listbox"]')).toBeNull();
        expect(level()).toEqual(fieldLevel('51'));
        await press();
        expect(level()).toEqual(familyLevel(5));
    });

    it('leaves a search box alone', async () => {
        const input = document.body.appendChild(document.createElement('input'));
        await press({}, input);
        input.remove();
        expect(level()).toEqual(fieldLevel('51'));
    });

    it('leaves the dashboard alone', async () => {
        const route = useStore.getState().route;
        useStore.setState({ route: 'dashboard' });
        await press();
        useStore.setState({ route });
        expect(level()).toEqual(fieldLevel('51'));
    });
});

describe('picker', () => {
    it('opens a field directly from the world, and Back lands on its family', async () => {
        await act(async () => container.querySelector<HTMLElement>('[data-field-picker]')!.click());
        const option = [...container.querySelectorAll<HTMLElement>('[role="option"]')].find((o) => o.textContent?.includes('Legal'))!;
        await act(async () => option.click());
        expect(level()).toEqual(fieldLevel('23'));
        await act(async () => buttonNamed('← Back')!.click());
        expect(level()).toEqual(familyLevel(1));
    });

    it('its first row is the whole map, in the new words', async () => {
        await act(async () => container.querySelector<HTMLElement>('[data-field-picker]')!.click());
        const first = container.querySelector('[role="option"]')!;
        expect(first.textContent).toBe('All families · whole map');
    });
});

describe('announcements', () => {
    it('says every level change through the aria-live text', async () => {
        expect(live()).toBe('Zoomed out: the five job families are showing.');
        await go(() => useWorldStore.getState().focusFamily(5));
        expect(live()).toContain('Production, Transportation & Moving family, 2 fields');
        await go(() => useWorldStore.getState().focusContinent('53'));
        expect(live()).toContain('Transportation & Moving field, in Production, Transportation & Moving');
        await go(() => useWorldStore.getState().goUp());
        expect(live()).toContain('Production, Transportation & Moving family');
    });
});

describe('focus', () => {
    it('a crumb that turns into text hands focus to Back', async () => {
        await go(() => useWorldStore.getState().focusContinent('51'));
        const crumb = buttonNamed('Production, Transportation & Moving')!;
        crumb.focus();
        await act(async () => crumb.click());
        expect(document.activeElement).toBe(buttonNamed('← Back'));
    });

    it('Back stays focused while it stays on screen', async () => {
        await go(() => useWorldStore.getState().focusContinent('51'));
        const back = buttonNamed('← Back')!;
        back.focus();
        await act(async () => back.click());
        expect(document.activeElement).toBe(buttonNamed('← Back'));
    });

    it('when Back itself goes, at the world, focus lands on the picker', async () => {
        await go(() => useWorldStore.getState().focusFamily(5));
        const back = buttonNamed('← Back')!;
        back.focus();
        await act(async () => back.click());
        expect(document.activeElement).toBe(container.querySelector('[data-field-picker]'));
    });

    it('Esc from a crumb does the same', async () => {
        await go(() => useWorldStore.getState().focusFamily(5));
        buttonNamed('All families')!.focus();
        await press();
        expect(document.activeElement).toBe(container.querySelector('[data-field-picker]'));
    });

    it('leaves focus alone when it was somewhere else', async () => {
        const other = document.body.appendChild(document.createElement('button'));
        other.focus();
        await go(() => useWorldStore.getState().focusContinent('51'));
        await go(() => useWorldStore.getState().goUp());
        expect(document.activeElement).toBe(other);
        other.remove();
    });
});

describe('info line', () => {
    const info = () => container.querySelector('[data-testid="family-info"]');
    const scale = () => container.querySelector('[data-testid="field-scale-note"]');

    it('at a family: its name, workers, fields and occupations, and no growth', async () => {
        await go(() => useWorldStore.getState().focusFamily(4));
        const s = familySummary(4);
        expect(info()!.textContent).toBe(
            `Natural Resources, Construction & Maintenance · ${formatCount(s.workers)} workers · ${s.fields} fields · ${s.occupations} occupations`,
        );
        expect(info()!.textContent).not.toMatch(/%|by 20/);
    });

    it('hides the family name on a phone, where the breadcrumb right above carries it', async () => {
        await go(() => useWorldStore.getState().focusFamily(4));
        const name = [...info()!.querySelectorAll('span')].find((s) => s.textContent?.startsWith('Natural Resources'))!;
        expect(name.className).toContain('max-md:hidden');
        const rest = [...info()!.querySelectorAll('span')].filter((s) => s !== name);
        expect(rest.every((s) => !s.className.includes('max-md:hidden'))).toBe(true);
        expect(rest[0].textContent!.startsWith(' ·')).toBe(false);
    });

    it('says when a family has no Kelley roles, as a field does', async () => {
        await go(() => useWorldStore.getState().focusFamily(4));
        await go(() => useWorldStore.getState().setKelleyOnly(true));
        expect(info()!.textContent).toContain('no Kelley roles in this family');
    });

    it('keeps "no Kelley roles in this field" at a field', async () => {
        await go(() => useWorldStore.getState().focusContinent('47'));
        await go(() => useWorldStore.getState().setKelleyOnly(true));
        expect(container.textContent).toContain('no Kelley roles in this field');
    });

    it('says whose scale the heights are on, at a field and at a family, and never at the world', async () => {
        const familyScale = () => container.querySelector('[data-testid="family-scale-note"]');
        expect(scale()).toBeNull();
        expect(familyScale()).toBeNull();
        await go(() => useWorldStore.getState().focusFamily(5));
        expect(scale()).toBeNull();
        expect(familyScale()!.textContent).toBe('Peak heights scaled within this family.');
        await go(() => useWorldStore.getState().focusContinent('51'));
        expect(scale()!.textContent).toBe('Peak heights scaled within this field.');
        expect(familyScale()).toBeNull();
        expect(info()).toBeNull();
    });
});
