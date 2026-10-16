import type { ReactNode, SVGProps } from 'react';

const P = (d: string) => <path d={d} />;

/** Outline icons (24px grid). Directional icons carry `dd-ic--flip` so they mirror in RTL via CSS. */
const ICONS: Record<string, ReactNode> = {
  heart: P(
    'M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 0 0 0-7.8z',
  ),
  pin: (
    <>
      {P('M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z')}
      <circle cx="12" cy="10" r="2.5" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      {P('M8 11V8a4 4 0 0 1 8 0v3')}
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      {P('m20 20-3.5-3.5')}
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      {P('M12 7v5l3 2')}
    </>
  ),
  phone: P(
    'M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z',
  ),
  back: P('M15 6l-6 6 6 6'),
  forward: P('M9 6l6 6-6 6'),
  compass: (
    <>
      <circle cx="12" cy="12" r="9" />
      {P('M15.5 8.5l-2 5-5 2 2-5z')}
    </>
  ),
  home: P('M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z'),
  gift: (
    <>
      <rect x="3" y="8" width="18" height="4" />
      <rect x="5" y="12" width="14" height="9" />
      {P('M12 8v13M12 8c-2-3-5-3-5-1s3 1 5 1zM12 8c2-3 5-3 5-1s-3 1-5 1z')}
    </>
  ),
  play: P('M8 5l11 7-11 7z'),
  user: (
    <>
      <circle cx="12" cy="8" r="4" />
      {P('M4 21a8 8 0 0 1 16 0')}
    </>
  ),
  sliders: (
    <>
      {P('M4 6h8M16 6h4M4 12h4M12 12h8M4 18h10M18 18h2')}
      <circle cx="14" cy="6" r="2" />
      <circle cx="10" cy="12" r="2" />
      <circle cx="16" cy="18" r="2" />
    </>
  ),
  check: P('M5 12l5 5 9-10'),
  x: P('M6 6l12 12M18 6L6 18'),
  tag: (
    <>
      {P('M3 12V4h8l10 10-8 8z')}
      <circle cx="7.5" cy="8.5" r="1.5" />
    </>
  ),
  dining: P('M6 3v8a2 2 0 0 0 2 2v8M10 3v8a2 2 0 0 1-2 2M18 3c-2 2-3 5-3 8h3v10'),
  cafes: P('M4 8h12v6a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5zM16 9h2a2 2 0 0 1 0 4h-2M7 3v2M11 3v2'),
  shopping: P('M5 8h14l-1 12H6zM9 8V6a3 3 0 0 1 6 0v2'),
  beauty: P('M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z'),
  entertainment: P(
    'M4 8a2 2 0 0 0 0 4 2 2 0 0 0 0 4v2h16v-2a2 2 0 0 1 0-4 2 2 0 0 1 0-4V6H4zM13 6v12',
  ),
  services: P('M14 6a4 4 0 0 0 5 5l-9 9a2.1 2.1 0 0 1-3-3l9-9a4 4 0 0 0-2-2z'),
  fitness: P('M6 8v8M9 6v12M15 6v12M18 8v8M9 12h6M3 10v4M21 10v4'),
  other: (
    <>
      <rect x="4" y="4" width="6" height="6" rx="1" />
      <rect x="14" y="4" width="6" height="6" rx="1" />
      <rect x="4" y="14" width="6" height="6" rx="1" />
      <rect x="14" y="14" width="6" height="6" rx="1" />
    </>
  ),
  bell: P('M6 9a6 6 0 0 1 12 0c0 6 2 7 2 7H4s2-1 2-7M10 20a2 2 0 0 0 4 0'),
  map: P('M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2zM9 4v14M15 6v14'),
  ticket: P(
    'M4 8a2 2 0 0 0 0 4v0a2 2 0 0 1 0 4v2h16v-2a2 2 0 0 1 0-4v0a2 2 0 0 0 0-4V6H4zM14 6v2M14 11v2M14 16v2',
  ),
  flame: P(
    'M12 3c1 3 4 4.5 4 8.5A4 4 0 0 1 12 15.5a4 4 0 0 1-4-4c0-1.6.8-2.7 1.7-3.7C10.6 6.8 11.6 5.4 12 3zM12 21a5.5 5.5 0 0 1-5.5-5.5c0-1 .3-1.9.8-2.7M12 21a5.5 5.5 0 0 0 5.5-5.5c0-1-.3-1.9-.8-2.7',
  ),
  qr: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      {P('M14 14h3v3h-3zM20 14v3M14 20h3M20 20h1')}
    </>
  ),
  scan: P(
    'M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2M4 12h16',
  ),
  keyboard: (
    <>
      <rect x="3" y="6" width="18" height="12" rx="2" />
      {P('M7 10h.01M11 10h.01M15 10h.01M7 14h10')}
    </>
  ),
  alert: (
    <>
      <circle cx="12" cy="12" r="9" />
      {P('M12 8v5M12 16.5h.01')}
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      {P('M12 11v5M12 8h.01')}
    </>
  ),
  wifioff: P(
    'M3 3l18 18M8.5 16.4a5 5 0 0 1 7 0M5 12.9a10 10 0 0 1 5-2.6M19 12.9a10 10 0 0 0-2.7-1.9M2 8.8a15 15 0 0 1 4.2-2.7M22 8.8A15 15 0 0 0 11 5M12 20h.01',
  ),
  history: (
    <>
      {P('M3 12a9 9 0 1 0 3-6.7L3 8')}
      {P('M3 3v5h5M12 7v5l3 2')}
    </>
  ),
  chart: P('M4 20V10M10 20V4M16 20v-7M22 20H2'),
  list: P('M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01'),
  star: P('m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.2l1.1-6.2L3 9.6l6.2-.9z'),
  share: (
    <>
      <circle cx="18" cy="5" r="2.5" />
      <circle cx="6" cy="12" r="2.5" />
      <circle cx="18" cy="19" r="2.5" />
      {P('m8.2 10.8 7.6-4.5M8.2 13.2l7.6 4.5')}
    </>
  ),
  chat: P('M20.5 11.6a8.4 8.4 0 0 1-12.5 7.3L3.5 20l1.2-4.3A8.4 8.4 0 1 1 20.5 11.6z'),
  card: (
    <>
      <rect x="2.5" y="5" width="19" height="14" rx="2.5" />
      {P('M2.5 10h19M6 15h4')}
    </>
  ),
  badge: (
    <>
      <rect x="4" y="3" width="16" height="18" rx="2.5" />
      <circle cx="12" cy="10" r="3" />
      {P('M8 17a4 4 0 0 1 8 0M10 3v2h4V3')}
    </>
  ),
  piggy: P(
    'M5 11a7 6 0 0 1 12-3l3-1-1 3.5a6 6 0 0 1 1 3.5h1v3h-2a7 6 0 0 1-3 2v2h-3v-1.5a8 8 0 0 1-2 0V22H8v-2.5A6 6 0 0 1 5 15H3v-3h2zM15 11h.01',
  ),
  plus: P('M12 5v14M5 12h14'),
  minus: P('M5 12h14'),
  locate: (
    <>
      <circle cx="12" cy="12" r="7" />
      <circle cx="12" cy="12" r="2.5" />
      {P('M12 2v3M12 19v3M2 12h3M19 12h3')}
    </>
  ),
};

export type IconName = keyof typeof ICONS | (string & {});

const DIRECTIONAL = new Set(['back', 'forward']);

export function Icon({
  name,
  size = 20,
  filled,
  className,
  ...rest
}: { name: IconName; size?: number; filled?: boolean; className?: string } & Omit<
  SVGProps<SVGSVGElement>,
  'name'
>) {
  const body = ICONS[name] ?? ICONS.other;
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={['dd-ic', DIRECTIONAL.has(name) ? 'dd-ic--flip' : '', className ?? '']
        .filter(Boolean)
        .join(' ')}
      {...rest}
    >
      {body}
    </svg>
  );
}
