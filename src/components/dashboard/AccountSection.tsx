/**
 * Session state + account controls (sign in/out, delete-my-data).
 * Lifted verbatim from the old AccountModal.tsx's "Session" block.
 */

import React, { useState } from 'react';
import { useUserStore } from '../../userStore';
import { toast } from '../ui/Toast';

export const AccountSection: React.FC = () => {
    const user = useUserStore((s) => s.user);
    const authStatus = useUserStore((s) => s.authStatus);
    const signInWithEmail = useUserStore((s) => s.signInWithEmail);
    const signOut = useUserStore((s) => s.signOut);
    const deleteMyData = useUserStore((s) => s.deleteMyData);
    const totalSaved = useUserStore((s) => s.activity.savedRoles.length + s.activity.upskillCompletions.length);

    const [email, setEmail] = useState('');
    const [busy, setBusy] = useState(false);
    const [notice, setNotice] = useState<string | null>(null);
    const [confirmingDelete, setConfirmingDelete] = useState(false);

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

    return (
        <div className="p-4 rounded-xl border border-white/10 bg-white/[0.03]">
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
                            className="dark-field flex-1 min-w-[200px] px-3 py-2 rounded-lg border border-white/10 text-sm placeholder:text-gray-600 focus:outline-none focus:border-indigo-400/50"
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

            {authStatus !== 'disabled' && authStatus !== 'loading' && (
                <div className="mt-4 pt-4 border-t border-white/[0.06]">
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
                    {/* Deliberately conditional: almost nobody has a key now
                        that only re-score asks for one, and asserting "your
                        Claude API key" to a student who never entered one
                        re-raises exactly the "do I need to buy an API key?"
                        worry this app just removed. */}
                    <p className="mt-2 text-[11px] text-gray-500">
                        If you’ve entered a Claude API key for re-scoring, it stays in this browser
                        only and is never part of your account. Résumé text is never uploaded or
                        stored — only the reports you explicitly save.
                    </p>
                </div>
            )}
        </div>
    );
};
