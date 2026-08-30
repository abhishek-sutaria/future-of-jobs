/**
 * Account panel: session state, saved activity, and data controls.
 *
 * Mounted from UI.tsx (never inside Header — Header is pointer-events-none at
 * Z.header=20 and sits below Z.timeBar=110, so a dialog nested there would take
 * no clicks and be painted over by the year slider; see AGENTS.md).
 * Uses the shared ui/Modal at layer="top" (Z.modalTop = 300), which brings the
 * focus trap, Escape handling and scroll lock with it.
 */

import React, { useState } from 'react';
import { Modal } from './ui/Modal';
import { useUserStore } from '../userStore';
import { useStore } from '../store';
import { toast } from './ui/Toast';

const Section: React.FC<{ title: string; count?: number; children: React.ReactNode }> = ({
    title, count, children,
}) => (
    <section className="mb-6 last:mb-0">
        <h3 className="text-[11px] uppercase tracking-wider font-semibold text-gray-400 mb-2">
            {title}
            {typeof count === 'number' && <span className="ml-2 text-gray-500">({count})</span>}
        </h3>
        {children}
    </section>
);

const Empty: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <p className="text-xs text-gray-500 italic">{children}</p>
);

export const AccountModal: React.FC = () => {
    const isOpen = useUserStore((s) => s.accountModalOpen);
    const closeModal = useUserStore((s) => s.closeAccountModal);
    const user = useUserStore((s) => s.user);
    const authStatus = useUserStore((s) => s.authStatus);
    const activity = useUserStore((s) => s.activity);
    const isLoadingActivity = useUserStore((s) => s.isLoadingActivity);
    const signInWithEmail = useUserStore((s) => s.signInWithEmail);
    const signOut = useUserStore((s) => s.signOut);
    const deleteMyData = useUserStore((s) => s.deleteMyData);
    const toggleSavedRole = useUserStore((s) => s.toggleSavedRole);

    const setSelectedJob = useStore((s) => s.setSelectedJob);

    const [email, setEmail] = useState('');
    const [busy, setBusy] = useState(false);
    const [notice, setNotice] = useState<string | null>(null);
    const [confirmingDelete, setConfirmingDelete] = useState(false);

    const openJob = (jobId: string) => {
        const job = useStore.getState().jobs.find((j) => j.id === jobId);
        if (!job) {
            toast.warning('That role is no longer in the dataset.');
            return;
        }
        setSelectedJob(job);
        closeModal();
    };

    const handleSignIn = async (e: React.FormEvent) => {
        e.preventDefault();
        setBusy(true);
        setNotice(null);
        const res = await signInWithEmail(email);
        setNotice(res.message);
        if (res.ok) setEmail('');
        setBusy(false);
    };

    const handleDelete = async () => {
        setBusy(true);
        const ok = await deleteMyData();
        setBusy(false);
        setConfirmingDelete(false);
        if (ok) toast.success('Your saved activity has been deleted.');
        else toast.warning('Could not delete your data. Please try again.');
    };

    const totalSaved = activity.savedRoles.length + activity.upskillCompletions.length;

    return (
        <Modal isOpen={isOpen} onClose={closeModal} title="Your Activity" size="lg" layer="top">
            {/* ── Session ─────────────────────────────────────────── */}
            <div className="mb-6 p-4 rounded-xl border border-white/10 bg-white/[0.03]">
                {authStatus === 'identified' && (
                    <>
                        <p className="text-sm text-white font-medium">Signed in as {user?.email}</p>
                        <p className="text-xs text-gray-400 mt-1">
                            Your activity follows this email on any device or browser.
                        </p>
                        <button
                            onClick={() => void signOut()}
                            className="mt-3 px-3 py-2 rounded-lg border border-white/[0.08] bg-white/[0.03] hover:bg-white/10 text-xs font-semibold uppercase tracking-wider text-gray-300 transition-colors min-h-[36px]"
                        >
                            Sign out
                        </button>
                    </>
                )}

                {authStatus === 'anonymous' && (
                    <>
                        <p className="text-sm text-white font-medium">You’re browsing as a guest</p>
                        <p className="text-xs text-gray-400 mt-1">
                            Your activity is already being saved to this browser’s guest account. Add an
                            email to keep it if you switch devices or clear your browser.
                        </p>
                        <form onSubmit={handleSignIn} className="mt-3 flex flex-wrap gap-2">
                            <input
                                type="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                placeholder="you@example.com"
                                className="flex-1 min-w-[200px] px-3 py-2 rounded-lg bg-black/40 border border-white/10 text-sm text-white placeholder:text-gray-600 focus:outline-none focus:border-indigo-400/50"
                            />
                            <button
                                type="submit"
                                disabled={busy || !email.trim()}
                                className="px-4 py-2 rounded-lg border border-indigo-500/30 bg-indigo-500/10 hover:bg-indigo-500/20 disabled:opacity-40 disabled:cursor-not-allowed text-xs font-semibold uppercase tracking-wider text-indigo-300 transition-colors min-h-[36px]"
                            >
                                {busy ? 'Sending…' : 'Keep my activity'}
                            </button>
                        </form>
                        <p className="mt-2 text-[11px] text-gray-500">
                            No password — we’ll email a one-click link. Nothing happens until you actually
                            click it, so typing someone else’s email can’t get into their account.
                        </p>
                    </>
                )}

                {authStatus === 'loading' && (
                    <p className="text-sm text-gray-400">Connecting…</p>
                )}

                {authStatus === 'disabled' && (
                    <>
                        <p className="text-sm text-white font-medium">Accounts aren’t set up for this build</p>
                        <p className="text-xs text-gray-400 mt-1">
                            Everything still works — your activity just isn’t saved between visits. See
                            README “Individual user activity” to enable it.
                        </p>
                    </>
                )}

                {notice && <p className="mt-3 text-xs text-indigo-300">{notice}</p>}
            </div>

            {authStatus !== 'disabled' && (
                <>
                    {isLoadingActivity && <Empty>Loading your activity…</Empty>}

                    <Section title="Saved roles" count={activity.savedRoles.length}>
                        {activity.savedRoles.length === 0 ? (
                            <Empty>No saved roles yet — open a role and choose Save.</Empty>
                        ) : (
                            <ul className="flex flex-wrap gap-2">
                                {activity.savedRoles.map((r) => (
                                    <li key={r.jobId} className="flex items-center rounded-lg border border-white/10 bg-white/[0.04] overflow-hidden">
                                        <button
                                            onClick={() => openJob(r.jobId)}
                                            className="px-3 py-2 text-xs text-gray-200 hover:text-white hover:bg-white/10 transition-colors"
                                        >
                                            {r.jobTitle}
                                        </button>
                                        <button
                                            onClick={() => void toggleSavedRole(r.jobId, r.jobTitle)}
                                            aria-label={`Remove ${r.jobTitle}`}
                                            className="px-2 py-2 text-gray-500 hover:text-red-400 hover:bg-white/10 transition-colors"
                                        >
                                            ×
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </Section>

                    <Section title="Recently viewed" count={activity.recentViews.length}>
                        {activity.recentViews.length === 0 ? (
                            <Empty>Roles you open will show up here.</Empty>
                        ) : (
                            <ul className="flex flex-wrap gap-2">
                                {activity.recentViews.slice(0, 12).map((v) => (
                                    <li key={v.jobId}>
                                        <button
                                            onClick={() => openJob(v.jobId)}
                                            className="px-3 py-2 rounded-lg border border-white/[0.08] bg-white/[0.02] text-xs text-gray-300 hover:text-white hover:bg-white/10 transition-colors"
                                        >
                                            {v.jobTitle}
                                            {v.viewCount > 1 && (
                                                <span className="ml-1.5 text-gray-500">×{v.viewCount}</span>
                                            )}
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </Section>

                    <Section title="Training completed" count={activity.upskillCompletions.length}>
                        {activity.upskillCompletions.length === 0 ? (
                            <Empty>Complete an upskilling task to track it here.</Empty>
                        ) : (
                            <ul className="space-y-1.5">
                                {activity.upskillCompletions.map((u) => (
                                    <li key={`${u.jobId}|${u.taskName}`} className="text-xs text-gray-300 flex gap-2">
                                        <span className="text-emerald-400 shrink-0">✓</span>
                                        <span className="line-clamp-2">{u.taskName}</span>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </Section>

                    {/* ── Data controls ───────────────────────────── */}
                    <div className="mt-6 pt-4 border-t border-white/[0.06]">
                        {!confirmingDelete ? (
                            <button
                                onClick={() => setConfirmingDelete(true)}
                                disabled={totalSaved === 0}
                                className="px-3 py-2 rounded-lg border border-red-500/25 bg-red-500/[0.06] hover:bg-red-500/15 disabled:opacity-30 disabled:cursor-not-allowed text-xs font-semibold uppercase tracking-wider text-red-300 transition-colors min-h-[36px]"
                            >
                                Delete my saved data
                            </button>
                        ) : (
                            <div className="flex flex-wrap items-center gap-2">
                                <span className="text-xs text-gray-300">
                                    Permanently delete all {totalSaved} saved items?
                                </span>
                                <button
                                    onClick={() => void handleDelete()}
                                    disabled={busy}
                                    className="px-3 py-2 rounded-lg border border-red-500/40 bg-red-500/20 hover:bg-red-500/30 text-xs font-semibold uppercase tracking-wider text-red-200 transition-colors min-h-[36px]"
                                >
                                    {busy ? 'Deleting…' : 'Yes, delete'}
                                </button>
                                <button
                                    onClick={() => setConfirmingDelete(false)}
                                    className="px-3 py-2 rounded-lg border border-white/[0.08] bg-white/[0.03] hover:bg-white/10 text-xs font-semibold uppercase tracking-wider text-gray-300 transition-colors min-h-[36px]"
                                >
                                    Cancel
                                </button>
                            </div>
                        )}
                        <p className="mt-2 text-[11px] text-gray-500">
                            Your Claude API key is stored separately in this browser and is never part of
                            your account. Résumé text is never uploaded or stored — only the reports you
                            explicitly save.
                        </p>
                    </div>
                </>
            )}
        </Modal>
    );
};
