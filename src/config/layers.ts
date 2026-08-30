export const Z = {
    base: 10,
    /** Drei Html job labels are trapped in an isolated z-0 stacking context (App.tsx), so all Z.* layers sit above them. */
    timeBar: 110,
    header: 20,
    sidebar: 150,
    detailPanel: 200,
    /** Full-page views (the dashboard). Above all map/3D chrome, below every modal — the dashboard's own dialogs reuse ui/Modal at `modal`/`modalTop` and sit correctly on top of it. */
    page: 230,
    modal: 250,
    modalTop: 300,
    /** Gate that blocks the whole app until a Claude key is chosen. Was a bare `z-[5000]` in ApiKeyModal.tsx; tokenized so its position in the stack is deliberate, not an arbitrary "big number". Deliberately above every modal — it must win when it needs to be shown at all — but see App.tsx for why it's suppressed while the dashboard is open. */
    apiKey: 400,
    toast: 9000,
    errorBoundary: 9999,
} as const;
