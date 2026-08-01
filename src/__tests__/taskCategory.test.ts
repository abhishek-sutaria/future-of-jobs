import { describe, it, expect } from 'vitest';
import { getTaskCategory } from '../data';
import { RISK_THRESHOLDS } from '../config/constants';

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

    it('avoids the old dual-bucket panel bug for mixed-score tasks', () => {
        const task = {
            aiCapabilityScore: 0.55,
            humanCriticalityScore: 0.65,
        };
        // Old JobDetailPanel filters (independent) put this task in BOTH cards:
        const oldRisk = task.aiCapabilityScore > RISK_THRESHOLDS.AUTOMATABLE_AI_SCORE;
        const oldSafe = task.humanCriticalityScore > RISK_THRESHOLDS.HUMAN_CRITICAL_SCORE;
        expect(oldRisk && oldSafe).toBe(true);

        // Mutually exclusive category used by the fixed panel:
        expect(getTaskCategory(task)).toBe('Human-Critical');
        expect(getTaskCategory(task)).not.toBe('Automatable');
    });
});
