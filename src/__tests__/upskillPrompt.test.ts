/**
 * Guards the upskill prompt.
 *
 * The original prompt told Claude, on every call, that the task "has high
 * human value and helps them stay resilient against automation" — while its
 * only caller was the HIGH-RISK task list. So the model was asked to justify
 * resilience for tasks the app had just flagged as automatable, and complied.
 * These tests exist so the premise can never invert again.
 */

import { describe, it, expect } from 'vitest';
import { buildUpskillPrompt } from '../utils/analysis';

const JOB = 'Brand Manager';
const RISK_TASK = 'Inspect layouts and advertising copy for adherence to specifications.';
const SAFE_TASK = 'Confer with department heads to discuss contracts and media selection.';

describe('defend mode (high automation risk)', () => {
    const prompt = buildUpskillPrompt(JOB, RISK_TASK, 'defend', 74);

    it('states the real exposure instead of asserting the task is human-valued', () => {
        expect(prompt).toContain('74% automation exposure');
        expect(prompt).not.toMatch(/high human value/i);
        expect(prompt).not.toMatch(/helps them stay resilient/i);
    });

    it('forbids training that just speeds up the automatable work', () => {
        expect(prompt).toMatch(/do NOT recommend/i);
        expect(prompt).toMatch(/faster or more cheaply by hand/i);
    });

    it('asks for the judgment layer, which is the part that survives', () => {
        expect(prompt).toMatch(/reviewing automated output|reviewing the output|directing and reviewing/i);
        expect(prompt).toMatch(/accountability and judgment/i);
    });

    it('rounds the exposure rather than leaking a float into the prompt', () => {
        expect(buildUpskillPrompt(JOB, RISK_TASK, 'defend', 73.6)).toContain('74% automation exposure');
    });
});

describe('build mode (human-critical task)', () => {
    const prompt = buildUpskillPrompt(JOB, SAFE_TASK, 'build', 12);

    it('uses the human-critical premise, which is true on this side of the panel', () => {
        expect(prompt).toMatch(/human-critical/i);
        expect(prompt).toMatch(/resists automation/i);
    });

    it('does not quote an automation exposure it is not reasoning from', () => {
        expect(prompt).not.toMatch(/automation exposure/i);
    });
});

describe('both modes', () => {
    const prompts = [
        buildUpskillPrompt(JOB, RISK_TASK, 'defend', 74),
        buildUpskillPrompt(JOB, SAFE_TASK, 'build', 12),
    ];

    it('keep the real-course constraint and the JSON contract', () => {
        for (const p of prompts) {
            expect(p).toContain('exactly 3 real, specific courses');
            expect(p).toMatch(/real course title that exists today/i);
            expect(p).toContain('"courses"');
            expect(p).toContain('"whyTheseCourses"');
            expect(p).toContain('Output JSON only');
            // The placeholder must always be substituted.
            expect(p).not.toContain('REPLACE_WHY');
        }
    });

    it('carry the job title and the task through to the model', () => {
        expect(prompts[0]).toContain(JOB);
        expect(prompts[0]).toContain(RISK_TASK);
        expect(prompts[1]).toContain(SAFE_TASK);
    });
});
