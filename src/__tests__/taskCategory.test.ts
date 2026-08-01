import { describe, it, expect } from 'vitest';
import { getTaskCategory } from '../data';

describe('getTaskCategory', () => {
    it('places the Cybersecurity encrypt/firewall task in Human-Critical only', () => {
        // Live baked scores: AI 0.55, human 0.65 — used to appear in both report cards
        // when JobDetailPanel filtered the two axes independently.
        const task = {
            aiCapabilityScore: 0.55,
            humanCriticalityScore: 0.65,
        };
        expect(getTaskCategory(task)).toBe('Human-Critical');
    });

    it('classifies high-AI / low-human tasks as Automatable', () => {
        expect(getTaskCategory({
            aiCapabilityScore: 0.8,
            humanCriticalityScore: 0.2,
        })).toBe('Automatable');
    });

    it('classifies mid-range tasks as Augmentable (neither report card)', () => {
        expect(getTaskCategory({
            aiCapabilityScore: 0.4,
            humanCriticalityScore: 0.4,
        })).toBe('Augmentable');
    });

    it('never returns both Automatable and Human-Critical for one task', () => {
        const samples = [
            { aiCapabilityScore: 0.55, humanCriticalityScore: 0.65 },
            { aiCapabilityScore: 0.51, humanCriticalityScore: 0.51 },
            { aiCapabilityScore: 0.9, humanCriticalityScore: 0.1 },
            { aiCapabilityScore: 0.1, humanCriticalityScore: 0.9 },
            { aiCapabilityScore: 0.5, humanCriticalityScore: 0.5 },
        ];
        for (const task of samples) {
            const cat = getTaskCategory(task);
            expect(['Automatable', 'Human-Critical', 'Augmentable']).toContain(cat);
            expect(cat === 'Automatable' && cat === 'Human-Critical').toBe(false);
        }
    });
});
