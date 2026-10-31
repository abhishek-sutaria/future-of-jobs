/** Lets OrbitControls (Landscape) cancel a CameraRig flight the moment the user grabs the view. */
export const worldCamera = {
    cancel: () => {},
};

export const prefersReducedMotion = (): boolean =>
    typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
