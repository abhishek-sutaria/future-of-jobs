export const Z = {
    base: 10,
    /** Drei Html job labels are trapped in an isolated z-0 stacking context (App.tsx), so all Z.* layers sit above them. */
    timeBar: 110,
    header: 20,
    sidebar: 150,
    detailPanel: 200,
    modal: 250,
    modalTop: 300,
    toast: 9000,
    errorBoundary: 9999,
} as const;
