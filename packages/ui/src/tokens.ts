/** Design tokens mirrored for TypeScript consumers (the CSS variables in styles.css are the runtime source). */
export const tokens = {
  color: {
    navy: '#0F0C42',
    purple: '#5B1AFC',
    purple2: '#7E4DFF',
    lilac: '#EEE8FF',
    bg: '#F8F9FD',
    card: '#FFFFFF',
    ink2: '#5B5E80',
    line: '#E3E1F0',
    success: '#0B7A5A',
    warning: '#8A5A00',
    danger: '#B3203A',
  },
  radius: { chip: 99, input: 14, card: 20, sheet: 26 },
  shadow: { card: '0 1px 2px rgba(20,22,58,.06),0 6px 18px rgba(20,22,58,.07)' },
  spacing: { screenPadding: 16, sectionGap: 24, cardGap: 12 },
  font: { en: 'Plus Jakarta Sans', ar: 'IBM Plex Sans Arabic' },
} as const;
