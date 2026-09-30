// Shader layer presets: { type: 'shader', preset: 'mesh', uniforms: { c0: '#...' } }.
// Each defines vec4 shade(vec2 px) returning premultiplied sRGB; px is in format pixels, y down;
// uFmt is the format size, uTime the film time (or the layer's own `time`).
export const SHADERS = {
  // three-stop linear gradient from point a to point b
  linear: {
    uniforms: { a: [0, 0], b: [0, 1080], c0: '#101114', c1: '#1c1f26', c2: '#2a2f3a', mid: 0.5 },
    code: `vec4 shade(vec2 px) {
  vec2 d = b - a;
  float k = clamp(dot(px - a, d) / max(dot(d, d), 1e-3), 0.0, 1.0);
  vec3 c = k < mid ? mix(c0, c1, k / max(mid, 1e-3)) : mix(c1, c2, (k - mid) / max(1.0 - mid, 1e-3));
  c = l2s(s2l(c)) + (hash21(px) - 0.5) / 255.0;
  return vec4(c, 1.0);
}`,
  },
  // radial gradient: inner colour at the centre fading to the outer colour at radius
  radial: {
    uniforms: { center: [960, 540], radius: 900, c0: '#2a2f3a', c1: '#0c0d10', power: 1.4, squash: 1 },
    code: `vec4 shade(vec2 px) {
  vec2 d = px - center; d.y /= squash;
  float k = pow(clamp(length(d) / radius, 0.0, 1.0), power);
  return vec4(mix(c0, c1, k) + (hash21(px) - 0.5) / 255.0, 1.0);
}`,
  },
  // a soft four-colour mesh gradient, slowly warped by noise
  mesh: {
    uniforms: { c0: '#1a2a6c', c1: '#b21f1f', c2: '#fdbb2d', c3: '#0f0c29', warp: 0.35, speed: 0.08, scale: 1.3 },
    code: `vec4 shade(vec2 px) {
  vec2 uv = px / uFmt;
  vec2 w = uv * scale + vec2(snoise(uv * 1.7 + uTime * speed), snoise(uv * 1.7 + 11.3 - uTime * speed)) * warp;
  vec2 f = clamp(w / scale, 0.0, 1.0);
  f = f * f * (3.0 - 2.0 * f);
  vec3 top = mix(s2l(c0), s2l(c1), f.x), bot = mix(s2l(c3), s2l(c2), f.x);
  vec3 c = l2s(mix(top, bot, f.y));
  return vec4(c + (hash21(px) - 0.5) / 255.0, 1.0);
}`,
  },
  // line grid over whatever is below (transparent between lines)
  grid: {
    uniforms: { spacing: 96, width: 1, color: '#ffffff', opacity: 0.08, offset: [0, 0], fade: 0 },
    code: `vec4 shade(vec2 px) {
  vec2 g = (px - offset) / spacing;
  vec2 f = abs(fract(g - 0.5) - 0.5) * spacing;
  vec2 a = 1.0 - smoothstep(width * 0.5 - 0.6, width * 0.5 + 0.6, f);
  float line = max(a.x, a.y);
  float v = 1.0;
  if (fade > 0.0) v = 1.0 - smoothstep(0.2, 0.75, length(px / uFmt - 0.5) * fade);
  float al = line * opacity * v;
  return vec4(color * al, al);
}`,
  },
  // dot grid
  dots: {
    uniforms: { spacing: 32, radius: 1.6, color: '#ffffff', opacity: 0.18, offset: [0, 0] },
    code: `vec4 shade(vec2 px) {
  vec2 c = (floor((px - offset) / spacing) + 0.5) * spacing + offset;
  float al = cover(length(px - c) - radius) * opacity;
  return vec4(color * al, al);
}`,
  },
  // fbm noise between two colours
  noise: {
    uniforms: { c0: '#0e0f13', c1: '#23262f', scale: 0.0025, speed: 0.05, octaves: 5, contrast: 1.2 },
    code: `vec4 shade(vec2 px) {
  float n = fbm(px * scale + vec2(uTime * speed, -uTime * speed * 0.7), int(octaves)) * contrast * 0.5 + 0.5;
  return vec4(mix(c0, c1, clamp(n, 0.0, 1.0)) + (hash21(px) - 0.5) / 255.0, 1.0);
}`,
  },
  // alternating wedges around a centre (the comic / riso sunburst)
  sunburst: {
    uniforms: { center: [960, 540], count: 18, c0: '#f4ecdf', c1: '#ee7ab0', turn: 0, soft: 1.2 },
    code: `vec4 shade(vec2 px) {
  vec2 d = px - center;
  float a = atan(d.y, d.x) / 6.2831853 + turn;
  float s = fract(a * count);
  // one pixel of arc, in wedge units (continuous across the atan seam, unlike fwidth)
  float w = max(count / (6.2831853 * max(length(d), 1.0)) * soft, 1e-4);
  float edge = min(abs(s - 0.5), min(s, 1.0 - s)) / w;
  float k = mix(0.5, step(0.5, s), clamp(edge, 0.0, 1.0));
  return vec4(mix(c0, c1, k), 1.0);
}`,
  },
  // soft light rays from a point
  rays: {
    uniforms: { center: [960, -200], color: '#ffffff', amount: 0.25, count: 9, spread: 0.6, speed: 0.05 },
    code: `vec4 shade(vec2 px) {
  vec2 d = px - center;
  float a = atan(d.x, d.y);
  float r = 0.0;
  for (int i = 0; i < 12; i++) {
    if (float(i) >= count) break;
    float ai = (hash11(float(i) * 3.1) - 0.5) * spread * 2.0 + sin(uTime * speed * 6.2831853 + float(i)) * 0.03;
    float wi = 0.01 + hash11(float(i) * 7.7) * 0.05;
    r += exp(-pow((a - ai) / wi, 2.0)) * (0.4 + 0.6 * hash11(float(i) * 1.9));
  }
  float fall = exp(-length(d) / (uFmt.y * 1.1));
  float al = clamp(r * amount * fall, 0.0, 1.0);
  return vec4(color * al, al);
}`,
  },
  // diagonal stripes (hazard, retail, riso fills)
  stripes: {
    uniforms: { width: 24, angle: 0.785, c0: '#111111', c1: '#f2c230', speed: 0 },
    code: `vec4 shade(vec2 px) {
  float s = dot(px, vec2(cos(angle), sin(angle))) / width + uTime * speed;
  float f = fract(s);
  float w = fwidth(s);
  float k = smoothstep(0.5 - w, 0.5 + w, f) - smoothstep(1.0 - w, 1.0, f);
  return vec4(mix(c0, c1, clamp(k, 0.0, 1.0)), 1.0);
}`,
  },
  // flat paper with tooth and fibres, for print looks under everything
  paper: {
    uniforms: { color: '#f2ece1', tooth: 0.05, scale: 1 },
    code: `vec4 shade(vec2 px) {
  vec2 p = px / scale;
  float n = fbm(p * 0.02, 5) * 0.5 + 0.5;
  float f = vnoise(p * vec2(0.5, 0.03)) * vnoise(p * vec2(0.03, 0.5));
  return vec4(color * (1.0 - tooth * (n * 0.7 + f * 0.6)), 1.0);
}`,
  },
};
