// @vitest-environment jsdom
/**
 * The Map view for every job (docs/state-map.md): a field's BLS state rows load
 * lazily with the field (worldStore.loadContinent) or for the Map view
 * (loadStateMap); a field with no Kelley role draws its own jobs instead of
 * the old "Kelley roles only" note; a hidden state reads "no data"; a job BLS
 * publishes no state data for gets a clear message; a Kelley role reads its
 * geo_real.json rows as before. react-simple-maps is replaced by plain SVG so
 * no map file is fetched.
 */

import React from 'react';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const STATES = ['California', 'Washington', 'Nebraska', 'Idaho', 'Ohio', 'Arizona'];

vi.mock('react-simple-maps', () => ({
    ComposableMap: ({ children }: { children: React.ReactNode }) => <svg>{children}</svg>,
    ZoomableGroup: ({ children }: { children: React.ReactNode }) => <g>{children}</g>,
    Geographies: ({ children }: { children: (a: { geographies: unknown[] }) => React.ReactNode }) => (
        <g>{children({ geographies: STATES.map((name) => ({ rsmKey: name, properties: { name } })) })}</g>
    ),
    Geography: ({ geography, fill, onMouseEnter }: { geography: { properties: { name: string } }; fill: string; onMouseEnter: (e: React.MouseEvent) => void }) => (
        <path data-state={geography.properties.name} data-fill={fill} onMouseOver={onMouseEnter} />
    ),
    Marker: ({ children }: { children: React.ReactNode }) => <g data-marker="">{children}</g>,
}));

import { MapView, NO_DATA_FILL } from '../components/MapView';
import { useStore } from '../store';
import { useWorldStore } from '../worldStore';
import { WORLD_LEVEL, fieldLevel } from '../utils/worldLevel';
import { isStateMapFieldLoaded, stateRowsFor, STATE_MAP_FIELDS } from '../utils/stateMapData';
import { OCCUPATION_INDEX } from '../utils/occupationIndex';
import { MAP_TITLE_TO_SOC } from '../utils/onet';
import { useMapRolesInScope } from '../hooks/useMapRoles';
import geoReal from '../data/geo_real.json';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ROOT = path.resolve(__dirname, '../..');
let root: Root;
let container: HTMLDivElement;

const mount = async (el: React.ReactElement) => {
    await act(async () => root.render(el));
    // Let the lazy state chunks arrive and the map re-render.
    for (let i = 0; i < 20 && container.querySelector('[data-testid="state-data-status"]'); i++) {
        await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    }
};
const hover = async (state: string) => {
    const p = container.querySelector(`path[data-state="${state}"]`)!;
    await act(async () => { p.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, clientX: 10, clientY: 10 })); });
};
const fillOf = (state: string) => container.querySelector(`path[data-state="${state}"]`)!.getAttribute('data-fill');
const select = (ids: string[]) => useStore.setState({ selectedRoleIds: new Set(ids) });

beforeEach(() => {
    useWorldStore.setState({ ...WORLD_LEVEL, selectedOccupationSoc: null });
    select([]);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body.innerHTML = '';
});

describe('lazy loading, per field', () => {
    it('only utils/stateMapData imports the chunks, through import.meta.glob (nothing in the main bundle but the 54 areas)', () => {
        // A static import, a dynamic import() or a glob of anything under data/state_map/.
        const IMPORTS_STATE_MAP = /(?:from\s*|import\s*\(\s*|import\.meta\.glob[^(]*\(\s*)['"][^'"]*state_map\//;
        const hits: string[] = [];
        const walk = (dir: string) => {
            for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
                const p = path.join(dir, e.name);
                if (e.isDirectory()) { if (e.name !== '__tests__' && e.name !== 'data') walk(p); }
                else if (/\.(ts|tsx)$/.test(e.name) && IMPORTS_STATE_MAP.test(fs.readFileSync(p, 'utf-8'))) hits.push(path.relative(ROOT, p));
            }
        };
        walk(path.join(ROOT, 'src'));
        expect(hits).toEqual(['src/utils/stateMapData.ts']);
        const src = fs.readFileSync(path.join(ROOT, 'src/utils/stateMapData.ts'), 'utf-8');
        expect(src).toContain("import.meta.glob<StateMapFieldFile>('../data/state_map/[0-9][0-9].json'");
        expect(src.match(/^import .*state_map.*$/gm)).toEqual(["import areasJson from '../data/state_map/areas.json';"]);
        expect(STATE_MAP_FIELDS).toHaveLength(22);
    });

    it('opening a field loads its state rows, and no other field', async () => {
        expect(isStateMapFieldLoaded('29')).toBe(false);
        expect(stateRowsFor('29-1141')).toBeUndefined();
        await useWorldStore.getState().loadContinent('29');
        await useWorldStore.getState().loadStateMap('29');
        expect(useWorldStore.getState().stateMapFields['29']).toBe(true);
        expect(stateRowsFor('29-1141')![0]).toMatchObject({ name: 'California', employment: 338940, lq: 0.86 });
        expect(stateRowsFor('29-1024')).toEqual([]);
        expect(isStateMapFieldLoaded('27')).toBe(false);
        expect(stateRowsFor('27-1011')).toBeUndefined();
    });
});

describe('the Map view', () => {
    it('in a field with no Kelley role, lists every job of the field and draws them', async () => {
        useWorldStore.setState({ ...fieldLevel('29') });
        const Probe = () => <ul data-testid="probe">{useMapRolesInScope().roles.map((r) => <li key={r.id}>{r.id}</li>)}</ul>;
        await mount(<><MapView /><Probe /></>);
        const listed = [...container.querySelectorAll('[data-testid="probe"] li')].map((li) => li.textContent);
        const field = OCCUPATION_INDEX.occupations.filter((o) => o.soc.startsWith('29-'));
        expect(listed).toEqual(field.map((o) => `soc:${o.soc}`));
        expect(container.textContent).not.toContain('Kelley roles only');
        select(['soc:29-1141']);
        await mount(<MapView />);
        await hover('California');
        expect(container.textContent).toContain('Registered Nurses');
        expect(container.textContent).toContain((338940).toLocaleString());
        expect(container.textContent).toContain('LQ 0.86');
    });

    it('a state BLS hides ("**") or does not list is grey, apart from the employment scale, and says so', async () => {
        useWorldStore.setState({ ...fieldLevel('21') });
        select(['soc:21-1019']);
        await mount(<MapView />);
        // Nebraska is "**" for Counselors, All Other; Idaho has no row.
        expect(fillOf('Nebraska')).toBe(NO_DATA_FILL);
        expect(fillOf('Idaho')).toBe(NO_DATA_FILL);
        expect(fillOf('California')).not.toBe(NO_DATA_FILL);
        // The grey is not on the slate-to-cyan employment scale.
        expect(NO_DATA_FILL).not.toBe('#1e293b');
        await hover('Nebraska');
        expect(container.textContent).toContain('no data');
        expect(container.textContent).toContain('No data from BLS for the selected roles in this state.');
    });

    it('a job BLS publishes no state data for gets a clear message, not an empty map', async () => {
        useWorldStore.setState({ ...fieldLevel('29') });
        select(['soc:29-1024']);
        await mount(<MapView />);
        const note = container.querySelector('[data-testid="no-state-data"]');
        expect(note?.textContent).toContain('BLS publishes no state data for this job');
        expect(note?.textContent).toContain('Prosthodontists');
        expect(container.querySelector('path[data-state]')).toBeNull();
        // With a job that has data, the map is back.
        select(['soc:29-1024', 'soc:29-1141']);
        await mount(<MapView />);
        expect(container.querySelector('[data-testid="no-state-data"]')).toBeNull();
        expect(container.querySelector('path[data-state="California"]')).not.toBeNull();
    });

    it('a Kelley role reads its geo_real.json rows, as before', async () => {
        const geo = geoReal as unknown as Record<string, { name: string; employment: number; lq: number }[]>;
        const jobs = useStore.getState().jobs.map((j) => ({ ...j, locations: geo[MAP_TITLE_TO_SOC[j.title]] as never }));
        useStore.setState({ jobs });
        const mm = jobs.find((j) => j.title === 'Marketing Manager')!;
        select([mm.id]);
        await mount(<MapView />);
        await hover('California');
        const ca = geo['11-2021'].find((r) => r.name === 'California')!;
        expect(container.textContent).toContain('Marketing Manager');
        expect(container.textContent).toContain(ca.employment.toLocaleString());
        expect(container.textContent).toContain(`LQ ${ca.lq.toFixed(2)}`);
    });

    it('Operations Research Analysts on its own: the 15th label is Arizona (tie at 2,600 jobs, A to Z)', async () => {
        const geo = geoReal as unknown as Record<string, { name: string; employment: number }[]>;
        const rows = geo['15-2031'];
        expect(rows[14]).toMatchObject({ name: 'Arizona', employment: 2600 });
        expect(rows[15]).toMatchObject({ name: 'Ohio', employment: 2600 });
    });
});
