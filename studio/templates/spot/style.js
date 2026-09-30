// TITLE: the art direction as code. Every shot imports this and nothing else decides colour, type or
// texture. Filled in from brief.md (Art direction) and the chosen concept; the styleframes prove it.
export const PALETTE = {
  ground: '#14131f',     // the main background
  ink: '#f4ecdf',        // primary type and line
  accent: '#ff5c8a',     // one accent, used sparingly (the hook, key words)
  second: '#3b5bdb',     // a supporting colour
};

// fonts: studio/fonts or the film's own fonts/ (OFL); families are referenced by these names
export const FONTS = [
  { family: 'Display', src: '/studio/fonts/InterDisplay-Bold.ttf', weight: 700 },
  { family: 'Text', src: '/studio/fonts/InterText-SemiBold.ttf', weight: 600 },
  { family: 'Mono', src: '/studio/fonts/GeistMono-VariableFont_wght.ttf', weight: '100 900' },
];
export const TYPE = {
  display: '"Display"', text: '"Text"', mono: '"Mono"',
  // a modular scale (1.333) from the body size at 1080p; multiply by F.u for other formats
  size: { hero: 220, h1: 150, h2: 96, h3: 64, body: 44, caption: 40, micro: 22 },
  track: { hero: -4, h1: -3, caps: 6, micro: 3 },
};

// the look over every frame (looks.js), and the caption style for lyrics
export const LOOK = [['grain', { amount: 0.028 }], ['vignette', { amount: 0.2 }]];
export const CAPTION = { style: 'box', family: '"Display"', color: PALETTE.ink, accent: PALETTE.accent };

// motion defaults: entrances snap and settle, exits are quicker than entrances
export const MOTION = { enter: 0.45, exit: 0.3, stagger: 0.06 };
