import React from 'react';
import { Modal } from './ui/Modal';
import RoleSelectorBody from './RoleSelectorBody';

interface RoleFilterSheetProps {
    isOpen: boolean;
    onClose: () => void;
}

/**
 * Mobile-only stand-in for the desktop RoleSelector sidebar (a fixed 320px
 * overlay that covers 82% of a phone screen and traps the user — see
 * RoleFilterButton and UI.tsx for how this is mounted). Reuses ui/Modal for
 * its focus trap, Escape handling, scroll lock and backdrop, and
 * RoleSelectorBody (scroll={false}) so the 50-row list has exactly one
 * scroll container, Modal's own — nesting a second one here previously
 * produced a confirmed-broken double scrollbar.
 */
export const RoleFilterSheet: React.FC<RoleFilterSheetProps> = ({ isOpen, onClose }) => (
    <Modal isOpen={isOpen} onClose={onClose} title="Filter roles" size="sm" layer="overlay">
        <RoleSelectorBody scroll={false} />
    </Modal>
);
