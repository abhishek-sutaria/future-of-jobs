import { describe, test, expect } from 'vitest';
import { looksBinary, isWordDoc } from '../utils/fileText';

describe('looksBinary', () => {
    test('accepts normal resume text', () => {
        const cv = 'John Doe\nSenior Product Manager\n- Led a team of 8 engineers\n- Grew ARR 40%';
        expect(looksBinary(cv)).toBe(false);
    });

    test('flags a docx ZIP signature', () => {
        // .docx files start with the ZIP local-file-header magic bytes "PK\x03\x04".
        expect(looksBinary('PK\u0003\u0004\u0014\u0000garbage')).toBe(true);
    });

    test('flags raw PDF bytes read as text', () => {
        expect(looksBinary('%PDF-1.7\n%\u00e2\u00e3')).toBe(true);
    });

    test('flags content with many non-printable characters', () => {
        const binary = Array.from({ length: 200 }, (_, i) => String.fromCharCode(i % 8)).join('');
        expect(looksBinary(binary)).toBe(true);
    });

    test('treats empty text as not binary', () => {
        expect(looksBinary('')).toBe(false);
    });
});

describe('isWordDoc', () => {
    test('detects .docx by extension', () => {
        expect(isWordDoc({ name: 'Resume.docx', type: '' })).toBe(true);
    });

    test('detects legacy .doc and Office mime types', () => {
        expect(isWordDoc({ name: 'cv.doc', type: '' })).toBe(true);
        expect(isWordDoc({ name: 'cv', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })).toBe(true);
    });

    test('does not flag pdf or txt', () => {
        expect(isWordDoc({ name: 'resume.pdf', type: 'application/pdf' })).toBe(false);
        expect(isWordDoc({ name: 'skills.txt', type: 'text/plain' })).toBe(false);
    });
});
