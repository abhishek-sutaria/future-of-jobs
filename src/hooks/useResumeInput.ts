import { useCallback, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { toast } from '../components/ui/Toast';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

// Word/other Office documents are ZIP archives; reading them as plain text used
// to silently produce mojibake that then got sent to Claude as if it were a CV.
// Detect that up front so the user gets an actionable message instead.
function looksBinary(text: string): boolean {
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

function isWordDoc(file: File): boolean {
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

interface UseResumeInputResult {
    resumeText: string;
    setResumeText: (value: string) => void;
    handleFileUpload: (e: React.ChangeEvent<HTMLInputElement>) => Promise<void>;
    isParsing: boolean;
}

/**
 * Shared resume/CV ingestion for the My Skills and Startup Ideas modals.
 * Handles PDF extraction (pdf.js), plain-text files, and rejects unsupported
 * binary formats (Word/Pages/RTF) with a clear, non-cryptic message.
 */
export function useResumeInput(): UseResumeInputResult {
    const [resumeText, setResumeText] = useState('');
    const [isParsing, setIsParsing] = useState(false);

    const handleFileUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        // Clear the input so re-selecting the same file still fires onChange.
        e.target.value = '';
        if (!file) return;

        if (isWordDoc(file)) {
            toast.error('Word/Pages files aren\u2019t supported. Export your CV as PDF, or paste the text below.');
            return;
        }

        if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
            setIsParsing(true);
            try {
                const arrayBuffer = await file.arrayBuffer();
                const pdf = await pdfjsLib.getDocument(arrayBuffer).promise;
                let fullText = '';
                for (let i = 1; i <= pdf.numPages; i++) {
                    const page = await pdf.getPage(i);
                    const textContent = await page.getTextContent();
                    const pageText = textContent.items.map((item) => ('str' in item ? item.str : '')).join(' ');
                    fullText += pageText + '\n';
                }
                if (fullText.trim().length < 20) {
                    toast.error('This PDF has no selectable text (it may be scanned). Paste your CV text below instead.');
                    return;
                }
                setResumeText(fullText);
                toast.success('Resume extracted successfully');
            } catch {
                toast.error('Failed to parse PDF. Try pasting text manually.');
            } finally {
                setIsParsing(false);
            }
            return;
        }

        setIsParsing(true);
        const reader = new FileReader();
        reader.onload = (event) => {
            setIsParsing(false);
            const text = (event.target?.result as string) ?? '';
            if (looksBinary(text)) {
                toast.error('That file isn\u2019t plain text. Upload a PDF or paste your CV text below.');
                return;
            }
            setResumeText(text);
            toast.success('File loaded');
        };
        reader.onerror = () => {
            setIsParsing(false);
            toast.error('Failed to read file');
        };
        reader.readAsText(file);
    }, []);

    return { resumeText, setResumeText, handleFileUpload, isParsing };
}
