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
    toast: 9000,
    errorBoundary: 9999,
} as const;
