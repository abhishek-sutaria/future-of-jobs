import React from 'react';
import { Modal } from './ui/Modal';
import { IconZap, IconRocket } from './ui/Icons';

interface MobileMoreSheetProps {
    isOpen: boolean;
    onClose: () => void;
    onOpenSkillsModal: () => void;
    onOpenStartupIdeasModal: () => void;
    onOpenStudentGuide: () => void;
}

/**
 * Mobile-only overflow menu (Header renders its trigger as `md:hidden`).
 * My Skills, Startup Ideas, and the Student Guide are `hidden md:flex` in the
 * header itself — on a phone they were simply unreachable. This surfaces
 * them without touching a single desktop class; the guided tour and
 * Methodology & Data are already visible on mobile and don't need a spot
 * here.
 */
export const MobileMoreSheet: React.FC<MobileMoreSheetProps> = ({
    isOpen, onClose, onOpenSkillsModal, onOpenStartupIdeasModal, onOpenStudentGuide,
}) => {
    const go = (action: () => void) => () => {
        onClose();
        action();
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="More" size="sm" layer="overlay">
            <div className="space-y-2">
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
            </div>
        </Modal>
    );
};
