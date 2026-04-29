import { test, expect } from 'vitest';
import { validateClaudeResponse } from '../utils/claude';

test('Claude response validation', () => {
    // 1. Valid response
    // JSON.stringify(0.70) becomes "0.7". But we are testing the raw string.
    // So if the raw string literally had 0.70 it would pass.
    const validRaw = `{"tasks": [{"task_text": "Task 1", "ai_exposure_score": 0.70, "human_criticality_score": 0.40, "reasoning": "Valid"}]}`;
    expect(() => validateClaudeResponse(validRaw)).not.toThrow();

    // 2. Missing ai_exposure_score
    const missingAi = `{"tasks": [{"human_criticality_score": 0.40, "reasoning": "Missing AI"}]}`;
    expect(() => validateClaudeResponse(missingAi)).toThrow();

    // 3. Score out of range
    const outOfRange = `{"tasks": [{"ai_exposure_score": 1.50, "human_criticality_score": -0.10, "reasoning": "Out"}]}`;
    expect(() => validateClaudeResponse(outOfRange)).toThrow();

    // 4. Score as wrong type
    const wrongType = `{"tasks": [{"ai_exposure_score": "high", "human_criticality_score": 0.40, "reasoning": "Wrong type"}]}`;
    expect(() => validateClaudeResponse(wrongType)).toThrow();

    // 5. Empty tasks array
    const emptyTasks = `{"tasks": []}`;
    expect(() => validateClaudeResponse(emptyTasks)).toThrow();

    // 6. Score as single decimal / integer
    const singleDecimal = `{"tasks": [{"ai_exposure_score": 0.7, "human_criticality_score": 1.0, "reasoning": "Single"}]}`;
    expect(() => validateClaudeResponse(singleDecimal)).toThrowError(/exactly 2 decimals/);

    const integerScore = `{"tasks": [{"ai_exposure_score": 1, "human_criticality_score": 0, "reasoning": "Integer"}]}`;
    expect(() => validateClaudeResponse(integerScore)).toThrowError(/exactly 2 decimals/);
});
