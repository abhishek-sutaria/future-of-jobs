// Pure helpers for validating uploaded resume/CV files. Kept free of pdf.js /
// React imports so they can be unit-tested and reused without side effects.

/**
 * Heuristic: does this text look like binary data read as text (e.g. a .docx
 * ZIP or a PDF opened via FileReader.readAsText) rather than a real resume?
 */
export function looksBinary(text: string): boolean {
    if (!text) return false;
    if (text.startsWith('PK\u0003\u0004') || text.startsWith('%PDF')) return true;
    const sample = text.slice(0, 4000);
    let nonPrintable = 0;
    for (const ch of sample) {
        const code = ch.codePointAt(0) ?? 0;
        if (code === 9 || code === 10 || code === 13) continue; // tab, LF, CR
        if (code < 32 || ch === '\uFFFD') nonPrintable++;
    }
    return sample.length > 0 && nonPrintable / sample.length > 0.1;
}

/** Word/Pages/RTF documents can't be read as plain text; detect them to warn early. */
export function isWordDoc(file: Pick<File, 'name' | 'type'>): boolean {
    const name = file.name.toLowerCase();
    return (
        name.endsWith('.docx') ||
        name.endsWith('.doc') ||
        name.endsWith('.pages') ||
        name.endsWith('.rtf') ||
        file.type.includes('officedocument') ||
        file.type === 'application/msword'
    );
}
