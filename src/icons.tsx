const base = { width: 24, height: 24, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" } as const;

export const HomeIcon = () => (
  <svg {...base}>
    <path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />
  </svg>
);
export const GridIcon = () => (
  <svg {...base}>
    <rect x="3" y="3" width="7" height="7" rx="1.5" />
    <rect x="14" y="3" width="7" height="7" rx="1.5" />
    <rect x="3" y="14" width="7" height="7" rx="1.5" />
    <rect x="14" y="14" width="7" height="7" rx="1.5" />
  </svg>
);
export const ClockIcon = () => (
  <svg {...base}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </svg>
);
export const SearchIcon = () => (
  <svg {...base}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </svg>
);
export const BookmarkIcon = ({ filled = false }: { filled?: boolean }) => (
  <svg {...base} fill={filled ? "currentColor" : "none"}>
    <path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z" />
  </svg>
);
export const ShareIcon = () => (
  <svg {...base}>
    <circle cx="18" cy="5" r="3" />
    <circle cx="6" cy="12" r="3" />
    <circle cx="18" cy="19" r="3" />
    <path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4" />
  </svg>
);
export const BackIcon = () => (
  <svg {...base}>
    <path d="M15 18 9 12l6-6" />
  </svg>
);
export const InfoIcon = () => (
  <svg {...base}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5M12 8h.01" />
  </svg>
);
export const PlayIcon = () => (
  <svg {...base} fill="currentColor" stroke="none">
    <path d="M8 5.14v13.72a1 1 0 0 0 1.52.85l11.1-6.86a1 1 0 0 0 0-1.7L9.52 4.29A1 1 0 0 0 8 5.14z" />
  </svg>
);
export const NextIcon = () => (
  <svg {...base}>
    <path d="m6 4 10 8-10 8zM19 5v14" />
  </svg>
);
export const PrevIcon = () => (
  <svg {...base}>
    <path d="m18 20-10-8 10-8zM5 19V5" />
  </svg>
);
export const PauseIcon = () => (
  <svg {...base} fill="currentColor" stroke="none">
    <rect x="6" y="4.5" width="4" height="15" rx="1.2" />
    <rect x="14" y="4.5" width="4" height="15" rx="1.2" />
  </svg>
);
export const Back10Icon = () => (
  <svg {...base}>
    <path d="M3 12a9 9 0 1 0 3-6.7" />
    <path d="M3 4v5h5" />
    <text x="12" y="15.5" fontSize="7.5" fontWeight="700" textAnchor="middle" fill="currentColor" stroke="none">10</text>
  </svg>
);
export const Forward10Icon = () => (
  <svg {...base}>
    <path d="M21 12a9 9 0 1 1-3-6.7" />
    <path d="M21 4v5h-5" />
    <text x="12" y="15.5" fontSize="7.5" fontWeight="700" textAnchor="middle" fill="currentColor" stroke="none">10</text>
  </svg>
);
export const VolumeIcon = ({ level }: { level: number }) => (
  <svg {...base}>
    <path d="M4 9h3l5-4v14l-5-4H4z" fill="currentColor" />
    {level === 0 ? (
      <path d="m16 9 5 6M21 9l-5 6" />
    ) : (
      <>
        <path d="M15.5 9.5a3.5 3.5 0 0 1 0 5" />
        {level > 0.5 && <path d="M18.5 6.5a7.5 7.5 0 0 1 0 11" />}
      </>
    )}
  </svg>
);
export const SettingsIcon = () => (
  <svg {...base}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
  </svg>
);
export const FullscreenIcon = ({ exit = false }: { exit?: boolean }) => (
  <svg {...base}>
    {exit ? <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" /> : <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />}
  </svg>
);
export const CloseIcon = () => (
  <svg {...base}>
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
);
export const ChevronIcon = ({ back = false }: { back?: boolean }) => (
  <svg {...base}>
    <path d={back ? "M15 18 9 12l6-6" : "m9 18 6-6-6-6"} />
  </svg>
);
export const CheckIcon = () => (
  <svg {...base}>
    <path d="m5 12 5 5 9-10" />
  </svg>
);
export const BellIcon = () => (
  <svg {...base}>
    <path d="M6 9a6 6 0 0 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9" />
    <path d="M10 20a2 2 0 0 0 4 0" />
  </svg>
);
export const CalendarIcon = () => (
  <svg {...base}>
    <rect x="3" y="5" width="18" height="16" rx="2" />
    <path d="M3 10h18M8 3v4M16 3v4" />
  </svg>
);
export const FlameIcon = () => (
  <svg {...base} fill="currentColor" stroke="none">
    <path d="M12.5 2c.9 3.6-1.3 5.6-3 7.6C8 11.3 6 13.2 6 16a6 6 0 0 0 12 0c0-2.6-1.3-4.6-2.6-6 .1 1.9-.6 3.3-1.9 3.8.7-3.6-.1-7.9-1-11.8Z" />
  </svg>
);
export const StarIcon = () => (
  <svg {...base} fill="currentColor" stroke="none">
    <path d="m12 2.8 2.8 5.8 6.3.9-4.6 4.4 1.1 6.3L12 17.2l-5.6 3 1.1-6.3-4.6-4.4 6.3-.9z" />
  </svg>
);
export const TrashIcon = () => (
  <svg {...base}>
    <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
  </svg>
);
