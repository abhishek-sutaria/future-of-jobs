import { describe, it, expect } from 'vitest';
import { resetViewVisible, type ResetViewContext } from '../utils/resetView';

const base: ResetViewContext = { mapView: 'globe', isDefaultView: false, zoomedToFields: true, onStage: false, isMobile: false };

describe('Reset view', () => {
    it('hides on a phone inside a family or field, even after panning', () => {
        expect(resetViewVisible({ ...base, onStage: true, isMobile: true })).toBe(false);
        expect(resetViewVisible({ ...base, onStage: true, isMobile: true, isDefaultView: true })).toBe(false);
    });

    it('stays on a phone at a zoomed world', () => {
        expect(resetViewVisible({ ...base, isMobile: true, isDefaultView: true })).toBe(true);
    });

    it('stays on a phone after panning the broad world', () => {
        expect(resetViewVisible({ ...base, isMobile: true, zoomedToFields: false })).toBe(true);
    });

    it('stays on the desktop inside a family or field', () => {
        expect(resetViewVisible({ ...base, onStage: true, isDefaultView: true })).toBe(true);
    });

    it('stays on a phone in the Tasks view, which has no Back of its own', () => {
        expect(resetViewVisible({ ...base, mapView: 'tasks', onStage: true, isMobile: true })).toBe(true);
    });

    it('has nothing to offer at the default world view, or on the 2D map, which has its own', () => {
        expect(resetViewVisible({ ...base, isDefaultView: true, zoomedToFields: false })).toBe(false);
        expect(resetViewVisible({ ...base, mapView: 'map' })).toBe(false);
    });
});
