import { useCallback, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { toast } from '../components/ui/Toast';
import { looksBinary, isWordDoc } from '../utils/fileText';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

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
