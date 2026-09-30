// Looks: a chain of image stages applied after motion blur (to the whole frame) or to one group
// of layers. Each stage is a GLSL function of the pixel position that may sample the previous
// stage anywhere (PREV(px)), so sampling looks (halftone cells, chromatic shifts, pixelation,
// CRT curvature) and colour looks (grade, duotone, riso inks, grain) stack in any order.
//
// In a film:  post: { looks: [['riso', { inkA: '#2b4bd8', inkB: '#ff4f8b' }], ['grain', { amount: 0.04 }]] }
// or on a group layer:  { type: 'group', layers: [...], fx: [['halftone', { cell: 7 }]] }
//
// Parameters: numbers -> float, '#hex' -> colour, [x, y(, z, w)] -> vector, an array of '#hex'
// strings -> a palette (up to 16 colours). Pixel positions are format pixels, y down; uFmt is the
// format size and uTime the film time.
import { HEADER, LIB, glslType, hexToRgb01 } from './glsl.js';

const HELPERS = {
  bayer: `float bayer8(vec2 p) {
  ivec2 q = ivec2(mod(p, 8.0));
  int x = q.x, y = q.y, z = x ^ y;
  int v = ((z & 1) << 5) | ((x & 1) << 4) | ((z & 2) << 2) | ((x & 2) << 1) | ((z & 4) >> 1) | ((x & 4) >> 2);
  return (float(v) + 0.5) / 64.0;
}`,
  inks: `vec2 inkWeights(vec3 s, vec3 paper, vec3 A, vec3 B) {
  // how much of each ink, printed on the paper, reproduces the colour s (subtractive, least squares)
  vec3 y = 1.0 - s / max(paper, vec3(0.001));
  vec3 u = 1.0 - A, v = 1.0 - B;
  float uu = dot(u, u), vv = dot(v, v), uv = dot(u, v), yu = dot(y, u), yv = dot(y, v);
  float det = uu * vv - uv * uv;
  vec2 w = det > 1e-5 ? vec2((yu * vv - yv * uv) / det, (yv * uu - yu * uv) / det) : vec2(yu / max(uu, 1e-5), 0.0);
  return clamp(w, 0.0, 1.0);
}`,
};

export const LOOKS = {
  // colour grade in display space: lift / gamma / gain per channel, contrast about mid grey, saturation
  grade: {
    params: { lift: [0, 0, 0], gamma: [1, 1, 1], gain: [1, 1, 1], contrast: 1, saturation: 1 },
    code: `vec4 c = PREV(px);
  vec3 x = $lift + c.rgb * ($gain - $lift);
  x = pow(max(x, 0.0), 1.0 / max($gamma, vec3(0.01)));
  x = (x - 0.5) * $contrast + 0.5;
  x = mix(vec3(luma(x)), x, $saturation);
  return vec4(clamp(x, 0.0, 1.0), c.a);`,
  },
  // map brightness onto three inks (shadow, mid, highlight)
  tritone: {
    params: { shadow: '#15122b', mid: '#d0542f', highlight: '#f4ecdf', amount: 1 },
    code: `vec4 c = PREV(px);
  float l = luma(c.rgb);
  vec3 t = l < 0.5 ? mix($shadow, $mid, l * 2.0) : mix($mid, $highlight, l * 2.0 - 1.0);
  return vec4(mix(c.rgb, t, $amount), c.a);`,
  },
  // an amplitude-modulated dot screen; color = 0 prints one ink by darkness, 1 prints the picture's own colour
  halftone: {
    params: { cell: 8, angle: 0.785, ink: '#141414', paper: '#f3eee6', color: 0, soft: 1, amount: 1 },
    code: `mat2 R = rot($angle);
  vec2 q = R * px;
  vec2 cc = (floor(q / $cell) + 0.5) * $cell;
  vec4 s = PREV(transpose(R) * cc);
  float dark = clamp(1.0 - luma(s.rgb), 0.0, 1.0);
  float r = sqrt(dark) * $cell * 0.7071;
  float cov = clamp(0.5 - (length(q - cc) - r) / max($soft, 0.05), 0.0, 1.0);
  vec3 dotc = mix($ink, s.rgb, $color);
  vec3 o = mix($paper, dotc, cov);
  vec4 c = PREV(px);
  return vec4(mix(c.rgb, o, $amount), c.a);`,
  },
  // two-ink risograph: the picture is separated into two inks on paper, each ink grainy and a little
  // out of register, then printed subtractively
  riso: {
    helpers: ['inks'],
    params: { paper: '#f2ede3', inkA: '#2c3e8f', inkB: '#ef5a8c', misreg: [1.6, -1.1], grain: 0.8, texture: 0.12, amount: 1 },
    code: `vec4 c = PREV(px);
  vec2 wa = inkWeights(c.rgb, $paper, $inkA, $inkB);
  vec2 wb = inkWeights(PREV(px - $misreg).rgb, $paper, $inkA, $inkB);
  float a = wa.x, b = wb.y;
  // grain: a stochastic threshold per ink, so flat tints break up like a riso drum
  float ga = hash21(floor(px)) * 0.6 + vnoise(px * 0.35) * 0.4;
  float gb = hash21(floor(px) + 71.3) * 0.6 + vnoise(px * 0.35 + 9.1) * 0.4;
  a = mix(a, smoothstep(ga - 0.18, ga + 0.18, a), $grain);
  b = mix(b, smoothstep(gb - 0.18, gb + 0.18, b), $grain);
  float paperN = 1.0 - $texture * (0.5 + 0.5 * fbm(px * 0.012, 4)) - $texture * 0.4 * vnoise(px * vec2(0.9, 0.05));
  vec3 o = $paper * paperN * (1.0 - a * (1.0 - $inkA)) * (1.0 - b * (1.0 - $inkB));
  return vec4(mix(c.rgb, o, $amount), c.a);`,
  },
  // ordered dither to a palette (or to N levels per channel) on a coarse pixel grid: PC-98, GameBoy, Mac
  dither: {
    helpers: ['bayer'],
    params: { pixel: 2, spread: 0.18, levels: 4, palette: [], amount: 1 },
    code: `vec2 cell = floor(px / $pixel);
  vec4 s = PREV((cell + 0.5) * $pixel);
  vec3 x = s.rgb + (bayer8(cell) - 0.5) * $spread;
  vec3 o;
  if ($palette_n > 0.5) {
    float best = 1e9; o = x;
    for (int i = 0; i < 16; i++) {
      if (float(i) >= $palette_n) break;
      vec3 d = x - $palette[i];
      float e = dot(d * vec3(0.30, 0.59, 0.11), d);
      if (e < best) { best = e; o = $palette[i]; }
    }
  } else {
    float n = max($levels - 1.0, 1.0);
    o = floor(clamp(x, 0.0, 1.0) * n + 0.5) / n;
  }
  vec4 c = PREV(px);
  return vec4(mix(c.rgb, o, $amount), c.a);`,
  },
  // a cathode-ray tube: barrel curvature, colour fringe, scanlines, aperture grille
  crt: {
    params: { curve: 0.06, chroma: 1.2, scan: 0.3, period: 3, mask: 0.12 },
    code: `vec2 uv = px / uFmt;
  vec2 cc = uv - 0.5;
  vec2 w = uv + cc * dot(cc, cc) * $curve * 4.0;
  if (w.x < 0.0 || w.x > 1.0 || w.y < 0.0 || w.y > 1.0) return vec4(0.0, 0.0, 0.0, 1.0);
  vec2 q = w * uFmt;
  vec3 c = vec3(PREV(q + vec2($chroma, 0.0)).r, PREV(q).g, PREV(q - vec2($chroma, 0.0)).b);
  float line = 0.5 + 0.5 * cos(q.y * 6.2831853 / $period);
  c *= 1.0 - $scan * (1.0 - line);
  float m = mod(floor(q.x), 3.0);
  vec3 mk = m < 0.5 ? vec3(1.0, 0.75, 0.75) : m < 1.5 ? vec3(0.75, 1.0, 0.75) : vec3(0.75, 0.75, 1.0);
  c *= mix(vec3(1.0), mk, $mask);
  return vec4(c, 1.0);`,
  },
  // paper: fibre and tooth texture, darker pigment at edges, warm paper in the highlights
  paper: {
    params: { color: '#f4ecdc', texture: 0.1, fiber: 0.6, edge: 0.35, scale: 1, amount: 1 },
    code: `vec4 c = PREV(px);
  vec2 p = px / $scale;
  float n = fbm(p * 0.018, 5) * 0.5 + 0.5;
  float f = vnoise(p * vec2(0.6, 0.035)) * vnoise(p * vec2(0.035, 0.6));
  float tooth = 1.0 - $texture * (n * 0.75 + f * $fiber);
  float gx = luma(PREV(px + vec2(2.0, 0.0)).rgb) - luma(PREV(px - vec2(2.0, 0.0)).rgb);
  float gy = luma(PREV(px + vec2(0.0, 2.0)).rgb) - luma(PREV(px - vec2(0.0, 2.0)).rgb);
  float edge = clamp(length(vec2(gx, gy)) * 2.5, 0.0, 1.0);
  vec3 x = c.rgb * tooth * (1.0 - $edge * edge * 0.45);
  x = mix(x, x * $color, $amount * smoothstep(0.55, 1.0, luma(c.rgb)));
  return vec4(x, c.a);`,
  },
  // line art from a picture (XDoG): ink lines where the picture has edges, over flattened colour or
  // plain paper. Turns generated footage into a drawing; put it first in a chain (it samples a lot).
  ink: {
    params: { sigma: 1.4, k: 1.6, tau: 0.985, eps: 0.012, phi: 55, ink: '#16151a', paper: '#f3eee4', color: 1, levels: 5, sat: 1.1, amount: 1 },
    code: `vec4 c = PREV(px);
  float s1 = 0.0, s2 = 0.0, w1 = 0.0, w2 = 0.0;
  vec3 col = vec3(0.0);
  float sp = $sigma * $k * 0.85;
  for (int j = -3; j <= 3; j++) for (int i = -3; i <= 3; i++) {
    vec2 o = vec2(float(i), float(j)) * sp;
    vec4 q = PREV(px + o);
    float d2 = dot(o, o);
    float a = exp(-d2 / (2.0 * $sigma * $sigma));
    float b = exp(-d2 / (2.0 * $sigma * $sigma * $k * $k));
    float l = luma(q.rgb);
    s1 += l * a; w1 += a;
    s2 += l * b; w2 += b;
    col += q.rgb * b;
  }
  s1 /= w1; s2 /= w2; col /= w2;
  float D = s1 - $tau * s2;
  float E = D >= $eps ? 1.0 : 1.0 + tanh($phi * (D - $eps));
  E = clamp(E, 0.0, 1.0);
  vec3 flatc = floor(col * $levels + 0.5) / $levels;
  flatc = mix(vec3(luma(flatc)), flatc, $sat);
  vec3 base = mix($paper, flatc, $color);
  vec3 o = mix($ink, base, E);
  return vec4(mix(c.rgb, o, $amount), c.a);`,
  },
  // painterly flattening (Kuwahara): each pixel takes the calmest of four neighbouring windows
  kuwahara: {
    params: { radius: 4, step: 1.5, amount: 1 },
    code: `vec3 m[4]; vec3 s[4];
  for (int q = 0; q < 4; q++) { m[q] = vec3(0.0); s[q] = vec3(0.0); }
  vec2 dirs[4] = vec2[](vec2(-1.0, -1.0), vec2(1.0, -1.0), vec2(-1.0, 1.0), vec2(1.0, 1.0));
  float n = 0.0;
  for (int j = 0; j <= 4; j++) for (int i = 0; i <= 4; i++) {
    if (float(i) > $radius || float(j) > $radius) continue;
    for (int q = 0; q < 4; q++) {
      vec3 v = PREV(px + dirs[q] * vec2(float(i), float(j)) * $step).rgb;
      m[q] += v; s[q] += v * v;
    }
    n += 1.0;
  }
  float best = 1e9; vec3 outc = vec3(0.0);
  for (int q = 0; q < 4; q++) {
    vec3 mean = m[q] / n;
    vec3 var = abs(s[q] / n - mean * mean);
    float v = var.r + var.g + var.b;
    if (v < best) { best = v; outc = mean; }
  }
  vec4 c = PREV(px);
  return vec4(mix(c.rgb, outc, $amount), c.a);`,
  },
  // colour fringing growing toward the edges
  chroma: {
    params: { amount: 1.5 },
    code: `vec2 d = px / uFmt - 0.5;
  vec2 o = d * 2.0 * $amount;
  vec4 c = PREV(px);
  return vec4(PREV(px + o).r, c.g, PREV(px - o).b, c.a);`,
  },
  // horizontal slices shifted sideways (a glitch hit); animate amount to 0 between hits
  slices: {
    params: { amount: 40, height: 18, density: 0.25, rate: 24, seed: 0 },
    code: `float band = floor(px.y / $height);
  float k = floor(uTime * $rate) + $seed * 17.0;
  float r = hash11(band * 1.7 + k * 13.1);
  float sh = r > 1.0 - $density ? (hash11(band * 7.3 + k) - 0.5) * 2.0 * $amount : 0.0;
  return PREV(px + vec2(sh, 0.0));`,
  },
  pixelate: {
    params: { size: 6 },
    code: `return PREV((floor(px / $size) + 0.5) * $size);`,
  },
  posterize: {
    params: { levels: 5, amount: 1 },
    code: `vec4 c = PREV(px);
  vec3 o = floor(c.rgb * ($levels - 1.0) + 0.5) / max($levels - 1.0, 1.0);
  return vec4(mix(c.rgb, o, $amount), c.a);`,
  },
  // barrel (k > 0) or pincushion (k < 0) distortion
  lens: {
    params: { k: 0.04 },
    code: `vec2 d = px / uFmt - 0.5;
  vec2 w = 0.5 + d * (1.0 + $k * dot(d, d) * 4.0);
  return PREV(w * uFmt);`,
  },
  // film grain, strongest in the mid tones
  grain: {
    params: { amount: 0.035, size: 1, mids: 0.6 },
    code: `vec4 c = PREV(px);
  vec2 g = floor(px / $size);
  float n = hash21(g + fract(uTime * 13.37) * 1000.0) + hash21(g * 1.37 + fract(uTime * 7.1) * 977.0) - 1.0;
  float l = luma(c.rgb);
  float m = mix(1.0, 4.0 * l * (1.0 - l), $mids);
  return vec4(c.rgb + n * $amount * m, c.a);`,
  },
  vignette: {
    params: { amount: 0.2, power: 2.6, color: '#000000' },
    code: `vec4 c = PREV(px);
  vec2 v = (px / uFmt - 0.5) * vec2(1.0, uFmt.y / uFmt.x);
  float k = $amount * pow(clamp(length(v) * 1.35, 0.0, 1.0), $power);
  return vec4(mix(c.rgb, $color, k), c.a);`,
  },
};

export function lookNames() { return Object.keys(LOOKS); }

// normalise [['name', params], 'name', { look: 'name', ...params }] into [{ name, params }]
export function normChain(chain = []) {
  return chain.filter(Boolean).map(s => {
    if (typeof s === 'string') return { name: s, params: {} };
    if (Array.isArray(s)) return { name: s[0], params: s[1] || {} };
    const { look, ...params } = s;
    return { name: look, params };
  }).map(s => {
    if (!LOOKS[s.name]) throw new Error(`unknown look "${s.name}" (have: ${lookNames().join(', ')})`);
    return s;
  });
}

// GLSL for a chain. mode 'final': the source is the linear accumulation (plus bloom), output straight
// sRGB (+ alpha when uAlphaOut). mode 'group': the source is a premultiplied sRGB layer texture,
// output premultiplied for compositing.
export function chainSource(chain, mode) {
  const decls = [], stages = [], helpers = new Set();
  chain.forEach((s, i) => {
    const L = LOOKS[s.name];
    (L.helpers || []).forEach(h => helpers.add(h));
    for (const [k, v] of Object.entries(L.params)) {
      if (Array.isArray(v) && (v.length === 0 || typeof v[0] === 'string')) {
        decls.push(`uniform vec3 L${i}_${k}[16];`, `uniform float L${i}_${k}_n;`);
      } else decls.push(`uniform ${glslType(v)} L${i}_${k};`);
    }
    const body = L.code.replace(/\$([a-zA-Z_]\w*)/g, `L${i}_$1`).replace(/PREV\(/g, `S${i}(`);
    stages.push(`vec4 S${i + 1}(vec2 px) {\n  ${body}\n}`);
  });
  const src0 = mode === 'final' ? `
vec4 S0(vec2 px) {
  vec2 uv = clamp(px * uScale / uRes, vec2(0.0), vec2(1.0));
  uv.y = 1.0 - uv.y;
  vec4 c = texture(uSrc, uv);
  vec3 lin = uAlphaOut > 0.5 ? c.rgb / max(c.a, 1e-5) : c.rgb;
  if (uBloomAmt > 0.0) lin += texture(uBloom, uv).rgb * uBloomAmt;
  lin *= uExposure;
  lin = mix(lin, uFade.rgb, uFade.a);
  return vec4(l2s(lin), uAlphaOut > 0.5 ? c.a : 1.0);
}` : `
vec4 S0(vec2 px) {
  vec2 uv = clamp(px * uScale / uRes, vec2(0.0), vec2(1.0));
  uv.y = 1.0 - uv.y;
  vec4 c = texture(uSrc, uv);
  return vec4(c.a > 0.0 ? c.rgb / c.a : vec3(0.0), c.a);
}`;
  const last = `S${chain.length}`;
  const main = mode === 'final' ? `
out vec4 o;
void main() {
  vec2 px = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) / uScale;
  vec4 c = ${last}(px);
  float n = hash21(gl_FragCoord.xy + fract(uTime * 7.31) * 131.0) + hash21(gl_FragCoord.yx * 1.37) - 1.0;
  c.rgb += n / 255.0;
  o = uAlphaOut > 0.5 ? vec4(clamp(c.rgb, 0.0, 1.0), c.a) : vec4(clamp(c.rgb, 0.0, 1.0), 1.0);
}` : `
out vec4 o;
void main() {
  vec2 px = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) / uScale;
  vec4 c = ${last}(px);
  o = vec4(clamp(c.rgb, 0.0, 1.0) * c.a, c.a) * uAlpha;
}`;
  return `${HEADER}
uniform sampler2D uSrc;
uniform sampler2D uBloom;
uniform vec2 uRes;
uniform vec2 uFmt;
uniform float uScale;
uniform float uTime;
uniform float uExposure;
uniform float uBloomAmt;
uniform vec4 uFade;
uniform float uAlphaOut;
uniform float uAlpha;
${LIB}
${[...helpers].map(h => HELPERS[h]).join('\n')}
${decls.join('\n')}
${src0}
${stages.join('\n')}
${main}`;
}

// set the chain's parameters (defaults filled in) on a compiled program's uniform table
export function setChainUniforms(gl, u, chain) {
  chain.forEach((s, i) => {
    const L = LOOKS[s.name];
    for (const [k, def] of Object.entries(L.params)) {
      const v = s.params[k] ?? def;
      const name = `L${i}_${k}`;
      if (Array.isArray(def) && (def.length === 0 || typeof def[0] === 'string')) {
        const pal = (v || []).slice(0, 16);
        const flat = new Float32Array(48);
        pal.forEach((hex, j) => flat.set(hexToRgb01(hex), j * 3));
        if (u[name] != null) gl.uniform3fv(u[name], flat);
        if (u[name + '_n'] != null) gl.uniform1f(u[name + '_n'], pal.length);
        continue;
      }
      const loc = u[name];
      if (loc == null) continue;
      if (typeof v === 'number') gl.uniform1f(loc, v);
      else if (typeof v === 'string') gl.uniform3fv(loc, hexToRgb01(v));
      else if (v.length === 2) gl.uniform2fv(loc, v);
      else if (v.length === 3) gl.uniform3fv(loc, typeof v[0] === 'number' ? v : hexToRgb01(v[0]));
      else if (v.length === 4) gl.uniform4fv(loc, v);
    }
  });
}

export const chainKey = chain => chain.map(s => s.name).join('>');
