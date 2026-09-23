import React from 'react';
import { Modal } from './ui/Modal';
import { IconZap, IconRocket, IconInfo, IconLayers } from './ui/Icons';

interface MobileMoreSheetProps {
    isOpen: boolean;
    onClose: () => void;
    onOpenSkillsModal: () => void;
    onOpenStartupIdeasModal: () => void;
    onOpenStudentGuide: () => void;
    onShowMethodology: () => void;
    onOpenTaskView: () => void;
}

/**
 * Mobile-only overflow menu (Header renders its trigger as `md:hidden`).
 * My Skills, Startup Ideas, and the Student Guide are `hidden md:flex` in the
 * header itself — on a phone they were simply unreachable. This surfaces
 * them without touching a single desktop class. Methodology & Data lives here
 * too: its floating pill shares the bottom-left corner with the year-slider
 * card, which spans the full width on a phone and covered it.
 */
export const MobileMoreSheet: React.FC<MobileMoreSheetProps> = ({
    isOpen, onClose, onOpenSkillsModal, onOpenStartupIdeasModal, onOpenStudentGuide, onShowMethodology, onOpenTaskView,
}) => {
    const go = (action: () => void) => () => {
        onClose();
        action();
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="More" size="sm" layer="overlay">
            <div className="space-y-2">
                <button
                    onClick={go(onOpenTaskView)}
                    className="w-full flex items-center gap-3 px-4 py-3.5 rounded-lg border border-teal-500/25 bg-teal-500/[0.06] hover:bg-teal-500/15 text-teal-300 text-sm font-semibold transition-colors min-h-[44px]"
                >
                    <IconLayers size={16} /> Task view
                    <span className="ml-auto px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 text-[9px] font-bold tracking-wider">
                        BETA
                    </span>
                </button>
                <button
                    onClick={go(onOpenSkillsModal)}
                    className="w-full flex items-center gap-3 px-4 py-3.5 rounded-lg border border-cyan-500/20 bg-cyan-500/[0.06] hover:bg-cyan-500/15 text-cyan-300 text-sm font-semibold transition-colors min-h-[44px]"
                >
                    <IconZap size={16} /> My Skills
                </button>
                <button
                    onClick={go(onOpenStartupIdeasModal)}
                    className="w-full flex items-center gap-3 px-4 py-3.5 rounded-lg border border-violet-500/25 bg-violet-500/[0.06] hover:bg-violet-500/15 text-violet-300 text-sm font-semibold transition-colors min-h-[44px]"
                >
                    <IconRocket size={16} /> Startup Ideas
                </button>
                <button
                    onClick={go(onOpenStudentGuide)}
                    className="w-full flex items-center gap-3 px-4 py-3.5 rounded-lg border border-amber-500/25 bg-amber-500/[0.06] hover:bg-amber-500/15 text-amber-400 text-sm font-semibold transition-colors min-h-[44px]"
                >
                    <span className="text-base leading-none">📋</span> Student Guide
                </button>
                <button
                    onClick={go(onShowMethodology)}
                    className="w-full flex items-center gap-3 px-4 py-3.5 rounded-lg border border-white/10 bg-white/[0.04] hover:bg-white/[0.08] text-gray-300 text-sm font-semibold transition-colors min-h-[44px]"
                >
                    <IconInfo size={16} /> Methodology &amp; Data
                </button>
            </div>
        </Modal>
    );
};
