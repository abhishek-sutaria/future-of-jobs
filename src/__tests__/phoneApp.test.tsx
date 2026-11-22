// @vitest-environment jsdom
/**
 * Installable phone app (Step 3 of 6, 2026-11-22):
 * - public/manifest.webmanifest parses and has every field Chrome needs to
 *   install it, colours equal to the app's background and index.html's theme-color;
 * - every icon exists at its exact pixel size (read from the PNG header), and
 *   the committed PNGs and maskable SVG match a fresh scripts/build_icons.mjs;
 * - index.html links the manifest, icons and apple-* tags, and the old Vite
 *   favicon is gone;
 * - no service worker (stale chunks, utils/staleBuild);
 * - vercel.json serves the manifest and icons from the files, never the SPA page;
 * - every control pinned to a screen edge clears the notch and home bar in
 *   standalone mode, and nothing changes in a browser tab (the insets are 0px there);
 * - the "Add to Home Screen" tip shows only in iPhone/iPad Safari, never
 *   installed, never on Android or a desktop, never under the intro, and
 *   remembers being closed.
 * No Claude call anywhere.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';
import {
    INSTALL_TIP_STORAGE_KEY,
    INTRO_CLOSED_EVENT,
    isAppleTouchDevice,
    isSafari,
    shouldOfferInstallTip,
    type InstallTipEnv,
} from '../utils/installTip';
import { UI } from '../config/constants';

const ROOT = join(__dirname, '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

/** The app's real background: App.tsx's bg-gray-900 (Tailwind v4: oklch(21% 0.034 264.665) = #101828), which the transparent canvas shows. */
const APP_BACKGROUND = '#101828';

interface ManifestIcon { src: string; sizes: string; type: string; purpose?: string }
const manifest = JSON.parse(read('public/manifest.webmanifest')) as Record<string, unknown> & { icons: ManifestIcon[] };
const indexHtml = new JSDOM(read('index.html')).window.document;

/** Width and height from a PNG's IHDR chunk (bytes 16-23), after checking the signature. */
function pngSize(path: string): { width: number; height: number } {
    const b = readFileSync(join(ROOT, path));
    expect(b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(true);
    expect(b.subarray(12, 16).toString('ascii')).toBe('IHDR');
    return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}

describe('web app manifest', () => {
    it('has every field an installed app needs', () => {
        expect(manifest).toMatchObject({
            id: '/',
            name: 'Future of Jobs',
            start_url: '/',
            scope: '/',
            display: 'standalone',
            orientation: 'any',
        });
        expect(typeof manifest.short_name).toBe('string');
        // Home screens cut labels at about 12 characters.
        expect((manifest.short_name as string).length).toBeLessThanOrEqual(12);
        expect((manifest.description as string).length).toBeGreaterThan(20);
    });

    it('its colours are the app background, the same as index.html theme-color', () => {
        expect(manifest.background_color).toBe(APP_BACKGROUND);
        expect(manifest.theme_color).toBe(APP_BACKGROUND);
        expect(indexHtml.querySelector('meta[name="theme-color"]')?.getAttribute('content')).toBe(APP_BACKGROUND);
        expect(read('src/App.tsx')).toContain('relative w-full h-full bg-gray-900');
    });

    it('lists any-purpose 192 and 512 PNGs and a maskable 512 PNG', () => {
        const find = (sizes: string, purpose: string) =>
            manifest.icons.find((i) => i.sizes === sizes && i.type === 'image/png' && (i.purpose ?? 'any').split(' ').includes(purpose));
        expect(find('192x192', 'any')).toBeTruthy();
        expect(find('512x512', 'any')).toBeTruthy();
        expect(find('512x512', 'maskable')).toBeTruthy();
    });
});

describe('icons', () => {
    it('every manifest icon file exists at its stated size', () => {
        for (const icon of manifest.icons) {
            const path = join('public', icon.src);
            expect(existsSync(join(ROOT, path)), path).toBe(true);
            if (icon.type !== 'image/png') continue;
            const [w, h] = icon.sizes.split('x').map(Number);
            expect(pngSize(path), path).toEqual({ width: w, height: h });
        }
    });

    it('the apple-touch-icon is 180 px, the favicons 32 and 16 px', () => {
        expect(pngSize('public/icons/apple-touch-icon.png')).toEqual({ width: 180, height: 180 });
        expect(pngSize('public/icons/favicon-32.png')).toEqual({ width: 32, height: 32 });
        expect(pngSize('public/icons/favicon-16.png')).toEqual({ width: 16, height: 16 });
        expect(pngSize('public/icons/icon-192.png')).toEqual({ width: 192, height: 192 });
        expect(pngSize('public/icons/icon-512.png')).toEqual({ width: 512, height: 512 });
        expect(pngSize('public/icons/icon-maskable-512.png')).toEqual({ width: 512, height: 512 });
    });

    it('the PNGs and the maskable SVG are what scripts/build_icons.mjs makes from icon.svg', () => {
        const out = execFileSync(process.execPath, [join(ROOT, 'scripts', 'build_icons.mjs'), '--check'], { encoding: 'utf8' });
        expect(out).toContain('up to date');
    });

    it('the source SVG has no text, so no font or name can sneak in', () => {
        const svg = read('public/icons/icon.svg');
        expect(svg).not.toMatch(/<text\b|<image\b|xlink:href|href=/);
        expect(read('public/icons/icon-maskable.svg')).toContain('GENERATED by scripts/build_icons.mjs');
    });
});

describe('index.html', () => {
    const href = (sel: string) => indexHtml.querySelector(sel)?.getAttribute('href');
    const meta = (name: string) => indexHtml.querySelector(`meta[name="${name}"]`)?.getAttribute('content');

    it('links the manifest, the apple-touch-icon and the favicons, and each file exists', () => {
        expect(href('link[rel="manifest"]')).toBe('/manifest.webmanifest');
        expect(href('link[rel="apple-touch-icon"]')).toBe('/icons/apple-touch-icon.png');
        expect(href('link[rel="icon"][type="image/svg+xml"]')).toBe('/icons/icon.svg');
        expect(href('link[rel="icon"][sizes="32x32"]')).toBe('/icons/favicon-32.png');
        expect(href('link[rel="icon"][sizes="16x16"]')).toBe('/icons/favicon-16.png');
        for (const link of indexHtml.querySelectorAll('link[rel~="icon"], link[rel="apple-touch-icon"], link[rel="manifest"]')) {
            expect(existsSync(join(ROOT, 'public', link.getAttribute('href')!)), link.outerHTML).toBe(true);
        }
    });

    it('has the apple and mobile web app tags', () => {
        expect(meta('apple-mobile-web-app-capable')).toBe('yes');
        expect(meta('mobile-web-app-capable')).toBe('yes');
        expect(meta('apple-mobile-web-app-title')).toBe(manifest.short_name);
        expect(meta('apple-mobile-web-app-status-bar-style')).toBe('black-translucent');
        expect(meta('viewport')).toContain('viewport-fit=cover');
        expect(indexHtml.title).toBe('Future of Jobs');
    });

    it('the old Vite favicon is gone everywhere', () => {
        expect(existsSync(join(ROOT, 'public', 'vite.svg'))).toBe(false);
        expect(read('index.html')).not.toContain('vite.svg');
    });
});

describe('no service worker, no offline cache', () => {
    it('nothing registers one and public/ ships none', () => {
        const files: string[] = [];
        const walk = (dir: string) => {
            for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
                const p = join(dir, e.name);
                if (e.isDirectory()) walk(p);
                else if (/\.(ts|tsx|html)$/.test(e.name) && !p.includes('__tests__')) files.push(p);
            }
        };
        walk('src');
        files.push('index.html');
        for (const f of files) expect(read(f), f).not.toMatch(/serviceWorker\s*\.\s*register|workbox/);
        const pub = readdirSync(join(ROOT, 'public'));
        expect(pub.filter((n) => /^(sw|service-worker|workbox).*\.js$/.test(n))).toEqual([]);
        expect(read('package.json')).not.toMatch(/vite-plugin-pwa|workbox/);
    });
});

describe('vercel.json', () => {
    const routes = (JSON.parse(read('vercel.json')) as { routes: Record<string, unknown>[] }).routes;
    const fs = routes.findIndex((r) => r.handle === 'filesystem');

    it('nothing before the files rewrites the manifest or the icons', () => {
        expect(fs).toBeGreaterThan(0);
        for (const r of routes.slice(0, fs)) {
            if (!('dest' in r)) continue;
            const re = new RegExp(`^${r.src as string}$`);
            expect(re.test('/manifest.webmanifest'), JSON.stringify(r)).toBe(false);
            expect(re.test('/icons/icon-192.png'), JSON.stringify(r)).toBe(false);
        }
    });

    it('the manifest gets its content type, the icons a cache lifetime', () => {
        const before = routes.slice(0, fs);
        const m = before.find((r) => new RegExp(`^${r.src as string}$`).test('/manifest.webmanifest'));
        expect((m?.headers as Record<string, string>)['Content-Type']).toMatch(/^application\/manifest\+json/);
        expect(m?.continue).toBe(true);
        const i = before.find((r) => new RegExp(`^${r.src as string}$`).test('/icons/apple-touch-icon.png'));
        expect((i?.headers as Record<string, string>)['Cache-Control']).toMatch(/max-age=[1-9]/);
        expect(i?.continue).toBe(true);
    });

    it('a missing icon is a 404, not the SPA page', () => {
        const after = routes.slice(fs + 1);
        const first = after.find((r) => new RegExp(`^${r.src as string}$`).test('/icons/missing.png'));
        expect(first?.status).toBe(404);
        expect(new RegExp(`^${first?.src as string}$`).test('/manifest.webmanifest')).toBe(true);
    });
});

describe('standalone mode: edge controls clear the notch and the home bar', () => {
    const css = read('src/index.css');

    it('the insets are 0px in a browser tab and env(safe-area-inset-*) only when installed', () => {
        const rootBlock = css.match(/:root\s*\{([^}]*)\}/)?.[1] ?? '';
        for (const side of ['top', 'right', 'bottom', 'left']) {
            expect(rootBlock).toContain(`--safe-${side}: 0px`);
        }
        const standalone = css.slice(css.indexOf('@media (display-mode: standalone) {'));
        for (const side of ['top', 'right', 'bottom', 'left']) {
            expect(standalone).toContain(`--safe-${side}: env(safe-area-inset-${side}, 0px)`);
        }
        expect(standalone).toContain('-webkit-tap-highlight-color: transparent');
        // Pull-to-refresh and rubber-band stay off everywhere (was already so).
        expect(css).toMatch(/overscroll-behavior:\s*none/);
        expect(css).toMatch(/@media \(display-mode: standalone\) and \(pointer: coarse\)[^{]*\{[^}]*textarea[^}]*\{\s*font-size: 16px/);
    });

    it.each([
        ['src/components/Header.tsx', ['top-[var(--safe-top)]', 'left-[var(--safe-left)]', 'right-[var(--safe-right)]']],
        ['src/components/WorldBar.tsx', ['var(--safe-left)', 'var(--safe-right)']],
        ['src/components/YearSlider.tsx', ['bottom-[calc(1.5rem+var(--safe-bottom))]', '[@media(max-height:480px)]:!bottom-[calc(0.5rem+var(--safe-bottom))]']],
        ['src/components/Legend.tsx', ['bottom-[calc(1.5rem+var(--safe-bottom))]', 'right-[calc(1.5rem+var(--safe-right))]']],
        ['src/components/ui/Toast.tsx', ['bottom-[calc(1.5rem+var(--safe-bottom))]']],
        ['src/components/RoleFilterButton.tsx', ['top-[calc(12rem+var(--safe-top))]']],
        ['src/components/MapView.tsx', ['top-[calc(8rem+var(--safe-top))]', 'bottom-[calc(6rem+var(--safe-bottom))]']],
        ['src/components/JobDetailPanel.tsx', ['safe-pad', 'max-h-[calc(92vh-var(--safe-top)-var(--safe-bottom))]']],
        ['src/components/OccupationPanel.tsx', ['safe-pad', 'max-h-[calc(92vh-var(--safe-top)-var(--safe-bottom))]']],
        ['src/components/ui/Modal.tsx', ['[--pad:1rem] safe-pad', 'max-h-[calc(90vh-var(--safe-top)-var(--safe-bottom))]']],
        ['src/components/dashboard/DashboardPage.tsx', ['pt-[var(--safe-top)]', 'pb-[var(--safe-bottom)]']],
    ])('%s uses the insets', (file, needles) => {
        const src = read(file);
        for (const n of needles) expect(src, n).toContain(n);
    });

    it('external links leave the app for the browser (new tab)', () => {
        expect(read('src/components/CourseLinkButton.tsx')).toMatch(/target="_blank"/);
        expect(read('src/components/MethodologyModal.tsx')).toMatch(/<a href=\{href\} target="_blank" rel="noopener noreferrer"/);
    });
});

// ── The tip ──────────────────────────────────────────────────────────────────

const UA = {
    iphoneSafari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
    ipadSafariDesktop: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
    ipadSafariMobile: 'Mozilla/5.0 (iPad; CPU OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1',
    iphoneChrome: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0.6778.73 Mobile/15E148 Safari/604.1',
    iphoneFirefox: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/132.0 Mobile/15E148 Safari/605.1.15',
    iphoneInstagram: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 357.0.0.25.101',
    androidChrome: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
    macSafari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
    windowsChrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
};

const env = (userAgent: string, over: Partial<InstallTipEnv> = {}): InstallTipEnv => ({
    userAgent,
    platform: /iPhone/.test(userAgent) ? 'iPhone' : /iPad/.test(userAgent) ? 'iPad' : /Android/.test(userAgent) ? 'Linux armv8l' : /Windows/.test(userAgent) ? 'Win32' : 'MacIntel',
    maxTouchPoints: /iPhone|iPad|Android/.test(userAgent) ? 5 : 0,
    navigatorStandalone: /iPhone|iPad|Macintosh/.test(userAgent) ? false : undefined,
    displayModeStandalone: false,
    ...over,
});

describe('who gets the Add to Home Screen tip', () => {
    it('iPhone and iPad Safari do', () => {
        expect(shouldOfferInstallTip(env(UA.iphoneSafari), false)).toBe(true);
        expect(shouldOfferInstallTip(env(UA.ipadSafariMobile), false)).toBe(true);
        // iPadOS Safari asks for desktop sites: a Mac user agent, but a touch screen.
        expect(shouldOfferInstallTip(env(UA.ipadSafariDesktop, { maxTouchPoints: 5 }), false)).toBe(true);
    });

    it('not once installed (either signal), and not once closed', () => {
        expect(shouldOfferInstallTip(env(UA.iphoneSafari, { navigatorStandalone: true }), false)).toBe(false);
        expect(shouldOfferInstallTip(env(UA.iphoneSafari, { displayModeStandalone: true }), false)).toBe(false);
        expect(shouldOfferInstallTip(env(UA.iphoneSafari), true)).toBe(false);
    });

    it('not other iPhone browsers or in-app views, not Android, not desktops', () => {
        for (const ua of [UA.iphoneChrome, UA.iphoneFirefox, UA.iphoneInstagram, UA.androidChrome, UA.macSafari, UA.windowsChrome]) {
            expect(shouldOfferInstallTip(env(ua), false), ua).toBe(false);
        }
        expect(isAppleTouchDevice(env(UA.macSafari))).toBe(false);
        expect(isSafari(UA.iphoneChrome)).toBe(false);
        expect(isSafari(UA.iphoneSafari)).toBe(true);
    });
});

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('InstallTip on screen', () => {
    let root: Root;
    let container: HTMLDivElement;
    let chrome: HTMLElement[] = [];

    /** A fake year slider and legend with real boxes (jsdom lays nothing out). */
    function addChrome() {
        const make = (attrs: Record<string, string>, rect: Partial<DOMRect>) => {
            const el = document.createElement('div');
            for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
            el.getBoundingClientRect = () => ({ top: 0, bottom: 0, left: 0, right: 0, width: 100, height: 0, x: 0, y: 0, toJSON: () => ({}), ...rect }) as DOMRect;
            document.body.appendChild(el);
            chrome.push(el);
        };
        make({ 'data-tour': 'tour-slider' }, { top: 700, bottom: 820, height: 120 });
        make({ 'data-legend': '' }, { top: 680, bottom: 820, height: 140 });
        make({ 'data-world-bar': '' }, { top: 90, bottom: 130, height: 40 });
    }

    async function mount() {
        const { InstallTip } = await import('../components/InstallTip');
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
        act(() => root.render(<InstallTip />));
    }

    function stubBrowser(userAgent: string, standalone = false) {
        vi.stubGlobal('navigator', { ...navigator, userAgent, platform: env(userAgent).platform, maxTouchPoints: env(userAgent).maxTouchPoints, standalone });
        vi.stubGlobal('matchMedia', (q: string) => ({ matches: standalone && q.includes('standalone'), media: q, addEventListener() {}, removeEventListener() {} }));
        Object.defineProperty(window, 'innerHeight', { value: 844, configurable: true });
    }

    beforeEach(() => {
        vi.useFakeTimers();
        localStorage.clear();
        addChrome();
    });

    afterEach(() => {
        act(() => root?.unmount());
        container?.remove();
        for (const el of chrome) el.remove();
        chrome = [];
        vi.useRealTimers();
        vi.unstubAllGlobals();
        localStorage.clear();
    });

    const tip = () => document.querySelector('[data-testid="install-tip"]');

    it('iPhone Safari: waits for the intro to close, shows above the legend and slider, close is remembered', async () => {
        stubBrowser(UA.iphoneSafari);
        await mount();
        act(() => { vi.advanceTimersByTime(5000); });
        expect(tip()).toBeNull(); // the intro is still open

        act(() => {
            localStorage.setItem(UI.INTRO_STORAGE_KEY, '1');
            window.dispatchEvent(new Event(INTRO_CLOSED_EVENT));
        });
        act(() => { vi.advanceTimersByTime(1000); });
        expect(tip()).toBeNull(); // a moment after, not at once
        act(() => { vi.advanceTimersByTime(1000); });
        const el = tip() as HTMLElement | null;
        expect(el).not.toBeNull();
        expect(el!.textContent).toContain('Add to Home Screen');
        // 844 - 680 (the legend, the higher of the two) + 10
        expect(el!.style.bottom).toBe('174px');

        act(() => (document.querySelector('button[aria-label="Close install tip"]') as HTMLButtonElement).click());
        expect(tip()).toBeNull();
        expect(localStorage.getItem(INSTALL_TIP_STORAGE_KEY)).toBe('1');
    });

    it('returning visitor who closed it: never again', async () => {
        stubBrowser(UA.iphoneSafari);
        localStorage.setItem(UI.INTRO_STORAGE_KEY, '1');
        localStorage.setItem(INSTALL_TIP_STORAGE_KEY, '1');
        await mount();
        act(() => { vi.advanceTimersByTime(5000); });
        expect(tip()).toBeNull();
    });

    it.each([
        ['installed iPhone', UA.iphoneSafari, true],
        ['Android Chrome', UA.androidChrome, false],
        ['desktop Chrome', UA.windowsChrome, false],
        ['desktop Safari', UA.macSafari, false],
    ])('%s: never', async (_name, ua, standalone) => {
        stubBrowser(ua, standalone);
        localStorage.setItem(UI.INTRO_STORAGE_KEY, '1');
        await mount();
        act(() => { vi.advanceTimersByTime(5000); });
        expect(tip()).toBeNull();
    });
});
