import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

const d = (size = 16): SVGProps<SVGSVGElement> => ({
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
});

export const IconSearch = ({ size, ...p }: IconProps) => (
    <svg {...d(size)} {...p}><circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" /></svg>
);

export const IconGlobe = ({ size, ...p }: IconProps) => (
    <svg {...d(size)} {...p}><circle cx="12" cy="12" r="10" /><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" /><path d="M2 12h20" /></svg>
);

export const IconMap = ({ size, ...p }: IconProps) => (
    <svg {...d(size)} {...p}><path d="m3 7 6-3 6 3 6-3v13l-6 3-6-3-6 3z" /><path d="M9 4v13" /><path d="M15 7v13" /></svg>
);

export const IconZap = ({ size, ...p }: IconProps) => (
    <svg {...d(size)} {...p}><path d="M13 2 3 14h9l-1 8 10-12h-9z" /></svg>
);

export const IconBrain = ({ size, ...p }: IconProps) => (
    <svg {...d(size)} {...p}>
        <path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z" />
        <path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z" />
        <path d="M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4" />
        <path d="M17.599 6.5a3 3 0 0 0 .399-1.375" />
        <path d="M6.002 5.125A3 3 0 0 0 6.401 6.5" />
        <path d="M3.477 10.896a4 4 0 0 1 .585-.396" />
        <path d="M19.938 10.5a4 4 0 0 1 .585.396" />
        <path d="M6 18a4 4 0 0 1-1.967-.516" />
        <path d="M19.967 17.484A4 4 0 0 1 18 18" />
    </svg>
);

export const IconShield = ({ size, ...p }: IconProps) => (
    <svg {...d(size)} {...p}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>
);

export const IconAlertTriangle = ({ size, ...p }: IconProps) => (
    <svg {...d(size)} {...p}>
        <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" />
        <path d="M12 9v4" /><path d="M12 17h.01" />
    </svg>
);

export const IconTarget = ({ size, ...p }: IconProps) => (
    <svg {...d(size)} {...p}><circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="6" /><circle cx="12" cy="12" r="2" /></svg>
);

export const IconX = ({ size, ...p }: IconProps) => (
    <svg {...d(size)} {...p}><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
);

export const IconSparkles = ({ size, ...p }: IconProps) => (
    <svg {...d(size)} {...p}>
        <path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z" />
    </svg>
);

export const IconInfo = ({ size, ...p }: IconProps) => (
    <svg {...d(size)} {...p}><circle cx="12" cy="12" r="10" /><path d="M12 16v-4" /><path d="M12 8h.01" /></svg>
);

export const IconKey = ({ size, ...p }: IconProps) => (
    <svg {...d(size)} {...p}>
        <circle cx="7.5" cy="15.5" r="5.5" />
        <path d="m21 2-9.6 9.6" />
        <path d="m15.5 7.5 3 3L22 7l-3-3" />
    </svg>
);

export const IconUpload = ({ size, ...p }: IconProps) => (
    <svg {...d(size)} {...p}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>
);

export const IconTrendingUp = ({ size, ...p }: IconProps) => (
    <svg {...d(size)} {...p}><polyline points="22 7 13.5 15.5 8.5 10.5 2 17" /><polyline points="16 7 22 7 22 13" /></svg>
);

export const IconTrendingDown = ({ size, ...p }: IconProps) => (
    <svg {...d(size)} {...p}><polyline points="22 17 13.5 8.5 8.5 13.5 2 7" /><polyline points="16 17 22 17 22 11" /></svg>
);

export const IconChevronDown = ({ size, ...p }: IconProps) => (
    <svg {...d(size)} {...p}><path d="m6 9 6 6 6-6" /></svg>
);

export const IconCheck = ({ size, ...p }: IconProps) => (
    <svg {...d(size)} {...p}><polyline points="20 6 9 17 4 12" /></svg>
);

export const IconBook = ({ size, ...p }: IconProps) => (
    <svg {...d(size)} {...p}><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20" /></svg>
);

export const IconActivity = ({ size, ...p }: IconProps) => (
    <svg {...d(size)} {...p}><polyline points="22 12 18 12 15 21 9 3 6 12 2 12" /></svg>
);

export const IconLayers = ({ size, ...p }: IconProps) => (
    <svg {...d(size)} {...p}><path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.84Z" /><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65" /><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65" /></svg>
);

export const IconClock = ({ size, ...p }: IconProps) => (
    <svg {...d(size)} {...p}><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
);

export const IconAward = ({ size, ...p }: IconProps) => (
    <svg {...d(size)} {...p}><circle cx="12" cy="8" r="6" /><path d="M15.5 14 20 22l-4-1-2.5 3" /><path d="M8.5 14 4 22l4-1 2.5 3" /></svg>
);

export const IconArrowRight = ({ size, ...p }: IconProps) => (
    <svg {...d(size)} {...p}><path d="M5 12h14" /><path d="m12 5 7 7-7 7" /></svg>
);

export const IconUser = ({ size, ...p }: IconProps) => (
    <svg {...d(size)} {...p}><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
);

export const IconBookmark = ({ size, ...p }: IconProps) => (
    <svg {...d(size)} {...p}><path d="m19 21-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" /></svg>
);

export const IconRocket = ({ size, ...p }: IconProps) => (
    <svg {...d(size)} {...p}>
        <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" />
        <path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z" />
        <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0" />
        <path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" />
    </svg>
);
