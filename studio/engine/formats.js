// Output formats and layout helpers. A film is laid out in format pixels; the engine can render any
// format at any internal scale (0.5 for drafts, 2 for 4K: format 'k' is the 16:9 layout at 2x).
//
// safe: the box readable text must stay inside. For 9:16 it keeps clear of the Reels / TikTok /
// Shorts interface (top bar, caption and buttons at the bottom, the action column on the right).
export const FORMATS = {
  h: { key: 'h', name: '16:9', W: 1920, H: 1080, safe: [80, 60, 1840, 1020], minText: 20 },
  v: { key: 'v', name: '9:16', W: 1080, H: 1920, safe: [80, 220, 940, 1560], minText: 26 },
  s: { key: 's', name: '1:1', W: 1080, H: 1080, safe: [60, 60, 1020, 1020], minText: 24 },
  p: { key: 'p', name: '4:5', W: 1080, H: 1350, safe: [60, 70, 1020, 1280], minText: 24 },
};
// 'k' (4K) and any unknown key render the 16:9 layout
export const ALIASES = { k: { key: 'h', scale: 2 } };
const FALLBACK = { h: [], v: ['p'], p: ['v', 's'], s: ['p', 'h'] };

export function resolveFormat(key = 'h') {
  if (ALIASES[key]) return { ...ALIASES[key] };
  return { key: FORMATS[key] ? key : 'h', scale: 1 };
}

export function layout(key = 'h') {
  const f = FORMATS[key] || FORMATS.h;
  const [x0, y0, x1, y1] = f.safe;
  const F = {
    ...f,
    cx: f.W / 2, cy: f.H / 2,
    u: Math.min(f.W, f.H) / 1080,              // 1 at 1080 on the short side
    portrait: f.H > f.W, square: f.H === f.W, landscape: f.W > f.H,
    safeBox: { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 },
    // a value per format: F.pick({ h: 120, v: 90 }) falls back along similar shapes, then to h
    pick(map) {
      if (key in map) return map[key];
      for (const k of FALLBACK[key] || []) if (k in map) return map[k];
      return map.h ?? Object.values(map)[0];
    },
    // scale (w, h) to fit inside (bw, bh)
    fit(w, h, bw, bh) { const k = Math.min(bw / w, bh / h); return { w: w * k, h: h * k, k }; },
    cover(w, h, bw, bh) { const k = Math.max(bw / w, bh / h); return { w: w * k, h: h * k, k }; },
  };
  return F;
}
