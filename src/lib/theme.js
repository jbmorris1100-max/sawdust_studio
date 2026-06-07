// Shared design tokens — single source of truth for all screens
// Matches website CSS custom properties exactly

export const T = {
  // Backgrounds
  bg:           '#050608',
  surface:      '#0a0d10',
  input:        '#0f1418',

  // Text
  text:         '#E6F0EE',
  muted:        '#9AAAA7',
  muteDark:     '#5F6F6C',

  // Borders
  border:       'rgba(94,234,212,0.12)',
  borderStrong: 'rgba(94,234,212,0.22)',

  // Teal accent (matches --teal-bright / --teal / --teal-deep)
  accent:       '#2DE1C9',
  accentDim:    '#5EEAD4',
  accentDeep:   '#14B8A6',

  // Status
  success:       '#34D399',
  successBg:     'rgba(52,211,153,0.08)',
  successBorder: 'rgba(52,211,153,0.2)',

  danger:       '#F87171',
  dangerBg:     'rgba(248,113,113,0.08)',
  dangerBorder: 'rgba(248,113,113,0.2)',

  amber:        '#FBBF24',
  amberBg:      'rgba(251,191,36,0.08)',
  amberBorder:  'rgba(251,191,36,0.2)',

  violet:       '#A78BFA',
  violetBg:     'rgba(167,139,250,0.08)',
  violetBorder: 'rgba(167,139,250,0.2)',
};

// Dept color chips
export const DEPT_COLORS = {
  Production: { bg: 'rgba(94,234,212,0.08)',  text: '#5EEAD4' },
  Assembly:   { bg: 'rgba(52,211,153,0.08)',  text: '#34D399' },
  Finishing:  { bg: 'rgba(251,191,36,0.08)',  text: '#FBBF24' },
  Craftsman:  { bg: 'rgba(167,139,250,0.08)', text: '#A78BFA' },
};

// Status pill colors
export const STATUS_COLORS = {
  pending:   { bg: 'rgba(94,234,212,0.08)',  text: '#5EEAD4', border: 'rgba(94,234,212,0.2)'  },
  ordered:   { bg: 'rgba(167,139,250,0.08)', text: '#A78BFA', border: 'rgba(167,139,250,0.2)' },
  received:  { bg: 'rgba(52,211,153,0.08)',  text: '#34D399', border: 'rgba(52,211,153,0.2)'  },
  cancelled: { bg: 'rgba(95,111,108,0.12)',  text: '#5F6F6C', border: 'rgba(95,111,108,0.2)'  },
  open:      { bg: 'rgba(248,113,113,0.08)', text: '#F87171', border: 'rgba(248,113,113,0.2)' },
  reviewed:  { bg: 'rgba(167,139,250,0.08)', text: '#A78BFA', border: 'rgba(167,139,250,0.2)' },
  resolved:  { bg: 'rgba(52,211,153,0.08)',  text: '#34D399', border: 'rgba(52,211,153,0.2)'  },
};

export const DEPARTMENTS = ['Production', 'Assembly', 'Finishing', 'Craftsman'];
