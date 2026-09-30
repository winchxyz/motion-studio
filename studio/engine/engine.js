// The compositor. A film's build(t) returns a stack of layers for time t; the engine draws them in
// order, composited in sRGB exactly as a browser blends them (so translucent UI greys come out the
// value a website shows), averages several jittered sub-frames over the shutter in linear light
// (motion blur and anti-aliasing), then runs the post chain: bloom, exposure, fade, looks.
//
// Layer types (all positions in format pixels, y down):
//   { type: 'fill', color, alpha }
//   { type: 'shader', code | preset, uniforms, alpha, blend }         code defines vec4 shade(vec2 px), premultiplied sRGB
//   { type: 'canvas', draw(ctx), alpha, blur, blend, stamp }           Canvas 2D; stamp = redraw only when it changes
//   { type: 'image', img, x, y, w, h, anchor, rot, bend, squash, wave, crop, tint, alpha, blend }   GPU sprite on a bendable mesh
//   { type: 'plane', name, tw, th, draw(ctx), x, y, z, w, h, rx, ry, rz, focal, pivotY, pivotZ, sheen, alpha, stamp }   a card in perspective
//   { type: 'three', layer, alpha, blend }                              a ThreeLayer (three-layer.js), rendered per sub-frame
//   { type: 'group', layers, alpha, blend, fx, mask, transform, blur } children into their own buffer, then looks, mask, transform
// blend: 'normal' | 'add' | 'screen' | 'multiply'.
// build(t) returns { layers, post } or just the layer array; post = { exposure, fade: { color, a }, bloom: { amount, threshold }, looks }.
import { HEADER, LIB, uniformDecl, setUniform, hexToRgb01 } from './glsl.js';
import { normChain, chainSource, setChainUniforms, chainKey } from './looks.js';
import { SHADERS } from './shaders.js';
import { halton } from './util.js';

const VS_FULL = `${HEADER}
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const FS_FILL = `${HEADER}
uniform vec4 uColor;   // premultiplied sRGB
out vec4 o;
void main() { o = uColor; }`;

// composite a texture into the current target: inverse transform, mask, tint, alpha
const FS_COMP = `${HEADER}
uniform sampler2D uTex;
uniform vec2 uRes;
uniform vec2 uTexRes;
uniform float uScale;
uniform float uTexScale;
uniform float uFlip;
uniform float uAlpha;
uniform vec3 uXa;
uniform vec3 uXb;
uniform float uMaskType;
uniform vec4 uMaskA;
uniform vec4 uMaskB;
uniform float uMaskInv;
uniform vec4 uTint;
${LIB}
out vec4 o;
float maskAt(vec2 px) {
  if (uMaskType < 0.5) return 1.0;
  float m;
  if (uMaskType < 1.5) {            // wipe: A = (dir x, dir y, position along dir, feather)
    m = clamp(0.5 - (dot(px, uMaskA.xy) - uMaskA.z) / max(uMaskA.w, 1.0), 0.0, 1.0);
  } else if (uMaskType < 2.5) {     // iris: A = (cx, cy, r, feather)
    m = clamp(0.5 - (length(px - uMaskA.xy) - uMaskA.z) / max(uMaskA.w, 1.0), 0.0, 1.0);
  } else if (uMaskType < 3.5) {     // rect: A = (x0, y0, x1, y1), B = (feather, radius)
    vec2 c = 0.5 * (uMaskA.xy + uMaskA.zw), h = 0.5 * abs(uMaskA.zw - uMaskA.xy);
    m = clamp(0.5 - sdRoundBox(px - c, h, uMaskB.y) / max(uMaskB.x, 1.0), 0.0, 1.0);
  } else {                          // clock: A = (cx, cy, start angle, sweep 0..1), B = (feather in turns)
    vec2 v = px - uMaskA.xy;
    float a = mod(atan(v.x, -v.y) - uMaskA.z, 6.2831853) / 6.2831853;
    m = clamp((uMaskA.w - a) / max(uMaskB.x, 1e-3) + 0.5, 0.0, 1.0);
  }
  return uMaskInv > 0.5 ? 1.0 - m : m;
}
void main() {
  vec2 px = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) / uScale;
  vec2 sp = vec2(dot(uXa, vec3(px, 1.0)), dot(uXb, vec3(px, 1.0)));
  vec2 uv = sp * uTexScale / uTexRes;
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) discard;
  if (uFlip > 0.5) uv.y = 1.0 - uv.y;
  vec4 t = texture(uTex, uv);
  if (uTint.a > 0.0) t.rgb = mix(t.rgb, t.rgb * uTint.rgb, uTint.a);
  o = t * uAlpha * maskAt(px);
}`;

// downsample (2x2 box) into a half-resolution target, GL-native rows
const FS_DOWN = `${HEADER}
uniform sampler2D uTex;
uniform vec2 uRes;
uniform float uFlip;
uniform vec2 uStep;
uniform float uThresh;   // bloom bright pass when > 0 (source is linear)
out vec4 o;
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  if (uFlip < 0.5) uv.y = 1.0 - uv.y;
  vec4 a = vec4(0.0);
  for (int y = 0; y < 2; y++) for (int x = 0; x < 2; x++) a += texture(uTex, uv + (vec2(x, y) - 0.5) * uStep);
  a *= 0.25;
  if (uThresh > 0.0) { float l = max(a.r, max(a.g, a.b)); a = vec4(a.rgb * max(l - uThresh, 0.0) / max(l, 1e-4), 1.0); }
  o = a;
}`;

const FS_BLUR = `${HEADER}
uniform sampler2D uTex;
uniform vec2 uRes;
uniform vec2 uDir;
out vec4 o;
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  float w[7] = float[](0.1964825502, 0.1760326633, 0.1209853623, 0.0647610469, 0.0269954833, 0.0087641502, 0.0022159242);
  vec4 c = texture(uTex, uv) * w[0];
  for (int i = 1; i < 7; i++) { c += texture(uTex, uv + uDir * float(i)) * w[i]; c += texture(uTex, uv - uDir * float(i)) * w[i]; }
  o = c;
}`;

// premultiplied sRGB sub-frame -> linear premultiplied, weighted into the accumulation
const FS_ACC = `${HEADER}
uniform sampler2D uTex;
uniform vec2 uRes;
uniform float uW;
${LIB}
out vec4 o;
void main() {
  vec4 c = texture(uTex, gl_FragCoord.xy / uRes);
  vec3 st = c.a > 0.0 ? clamp(c.rgb / c.a, 0.0, 1.0) : vec3(0.0);
  o = vec4(s2l(st) * c.a, c.a) * uW;
}`;

// a card in perspective: a Canvas 2D texture on a quad, rotated about a pivot line
const VS_PLANE = `${HEADER}
uniform vec2 uFmt;
uniform vec2 uJit;
uniform vec4 uPos;      // centre x, y (px), z (px, + = away), focal length (px)
uniform vec4 uSize;     // width, height (px at z = 0), pivot z offset, pivot y offset (-0.5 top .. 0.5 bottom)
uniform vec3 uRot;
out vec2 vUV;
void main() {
  vec2 c = vec2(float(gl_VertexID & 1), float((gl_VertexID >> 1) & 1));
  vUV = c;
  vec3 p = vec3((c - 0.5) * uSize.xy - vec2(0.0, uSize.w * uSize.y), -uSize.z);
  float cx = cos(uRot.x), sx = sin(uRot.x), cy = cos(uRot.y), sy = sin(uRot.y), cz = cos(uRot.z), sz = sin(uRot.z);
  p = vec3(cz * p.x - sz * p.y, sz * p.x + cz * p.y, p.z);
  p = vec3(p.x, cx * p.y - sx * p.z, sx * p.y + cx * p.z);
  p = vec3(cy * p.x + sy * p.z, p.y, -sy * p.x + cy * p.z);
  p.z += uSize.z + uPos.z;
  p.y += uSize.w * uSize.y;
  float f = uPos.w;
  float k = f / (f + p.z);
  vec2 s = uPos.xy + p.xy * k - uJit;
  gl_Position = vec4((s.x / uFmt.x * 2.0 - 1.0) * (f + p.z), (1.0 - s.y / uFmt.y * 2.0) * (f + p.z), 0.0, f + p.z);
}`;
const FS_PLANE = `${HEADER}
uniform sampler2D uTex;
uniform float uAlpha;
uniform vec4 uSheen;    // amount, position (-1..1 across), width, 0
in vec2 vUV;
out vec4 o;
void main() {
  vec4 t = texture(uTex, vUV, -0.5);
  if (t.a <= 0.002) discard;
  vec3 c = t.rgb / t.a;
  if (uSheen.x > 0.0) {
    float s = exp(-pow((vUV.x + vUV.y * 0.35 - uSheen.y) / max(uSheen.z, 0.01), 2.0));
    c = min(c + vec3(s * uSheen.x), vec3(1.0));
  }
  o = vec4(c * t.a, t.a) * uAlpha;
}`;

// an image on a grid mesh that can bend (sway), squash, ripple and skew about an anchor
const VS_SPRITE = `${HEADER}
uniform vec2 uFmt;
uniform vec2 uJit;
uniform vec4 uRect;     // anchor x, y (format px), width, height
uniform vec4 uXf;       // anchor u, v (0..1 of the image), rotation, 0
uniform vec4 uDef;      // bend (px at one image height), squash (y scale), wave amplitude (px), wave cycles per height
uniform vec4 uDef2;     // wave phase, skew, 0, 0
uniform vec4 uCrop;     // u0, v0, u1, v1
uniform float uGrid;
out vec2 vUV;
void main() {
  int n = int(uGrid);
  int quad = gl_VertexID / 6, corner = gl_VertexID - quad * 6;
  ivec2 offs[6] = ivec2[](ivec2(0, 0), ivec2(1, 0), ivec2(0, 1), ivec2(1, 0), ivec2(1, 1), ivec2(0, 1));
  vec2 g = vec2(ivec2(quad - (quad / n) * n, quad / n) + offs[corner]) / float(n);
  vUV = mix(uCrop.xy, uCrop.zw, g);
  vec2 p = (g - uXf.xy) * uRect.zw;
  float h = -p.y / max(uRect.w, 1.0);
  p.y *= uDef.y;
  p.x /= sqrt(max(uDef.y, 0.05));
  p.x += uDef.x * h * abs(h);
  p.x += uDef.z * sin(6.2831853 * uDef.w * h + uDef2.x) * clamp(abs(h) * 2.0, 0.0, 1.0);
  p.x += uDef2.y * (-p.y);
  float c = cos(uXf.z), s = sin(uXf.z);
  p = vec2(c * p.x - s * p.y, s * p.x + c * p.y);
  vec2 q = uRect.xy + p - uJit;
  gl_Position = vec4(q.x / uFmt.x * 2.0 - 1.0, 1.0 - q.y / uFmt.y * 2.0, 0.0, 1.0);
}`;
const FS_SPRITE = `${HEADER}
uniform sampler2D uTex;
uniform float uAlpha;
uniform vec4 uTint;
uniform float uBright;
in vec2 vUV;
out vec4 o;
void main() {
  vec4 t = texture(uTex, vUV);
  t.rgb = mix(t.rgb, t.rgb * uTint.rgb, uTint.a) * uBright;
  o = t * uAlpha;
}`;

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(s) + '\n' + src.split('\n').map((l, i) => `${i + 1}: ${l}`).join('\n'));
  }
  return s;
}
function program(gl, vs, fs) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const u = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) {
    const info = gl.getActiveUniform(p, i);
    u[info.name.replace(/\[0\]$/, '')] = gl.getUniformLocation(p, info.name);
  }
  return { p, u };
}

const BLENDS = {
  normal: gl => { gl.blendEquation(gl.FUNC_ADD); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); },
  add: gl => { gl.blendEquation(gl.FUNC_ADD); gl.blendFunc(gl.ONE, gl.ONE); },
  screen: gl => { gl.blendEquation(gl.FUNC_ADD); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_COLOR); },
  multiply: gl => { gl.blendEquation(gl.FUNC_ADD); gl.blendFunc(gl.DST_COLOR, gl.ONE_MINUS_SRC_ALPHA); },
};

const MASKS = { none: 0, wipe: 1, iris: 2, rect: 3, clock: 4 };

export class Engine {
  // W, H: format size; scale: internal resolution factor (0.5 for fast drafts); alpha: keep transparency
  constructor(canvas, W, H, { scale = 1, alpha = false, canvasLayers = 8 } = {}) {
    this.W = W; this.H = H; this.scale = scale; this.alphaOut = alpha;
    this.iw = Math.round(W * scale); this.ih = Math.round(H * scale);
    this.canvas = canvas;
    canvas.width = this.iw; canvas.height = this.ih;
    const gl = canvas.getContext('webgl2', { antialias: false, alpha, premultipliedAlpha: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
    if (!gl) throw new Error('WebGL2 unavailable');
    if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('EXT_color_buffer_float unavailable');
    this.gl = gl;
    this.floatBlend = !!gl.getExtension('EXT_float_blend');
    gl.getExtension('OES_texture_float_linear');
    this.aniso = gl.getExtension('EXT_texture_filter_anisotropic');
    this.P = {
      fill: program(gl, VS_FULL, FS_FILL),
      comp: program(gl, VS_FULL, FS_COMP),
      down: program(gl, VS_FULL, FS_DOWN),
      blur: program(gl, VS_FULL, FS_BLUR),
      acc: program(gl, VS_FULL, FS_ACC),
      plane: program(gl, VS_PLANE, FS_PLANE),
      sprite: program(gl, VS_SPRITE, FS_SPRITE),
    };
    this.shaderCache = new Map();
    this.chainCache = new Map();
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    const { iw, ih } = this;
    const accFmt = this.floatBlend ? [gl.RGBA32F, gl.FLOAT] : [gl.RGBA16F, gl.HALF_FLOAT];
    this.acc = this.target(iw, ih, ...accFmt);
    this.sub = this.target(iw, ih, gl.RGBA16F, gl.HALF_FLOAT);
    this.half = [this.target(iw >> 1, ih >> 1), this.target(iw >> 1, ih >> 1)];
    this.bloomT = [this.target(iw >> 2, ih >> 2), this.target(iw >> 2, ih >> 2)];
    if (!this.acc || !this.sub || !this.half[0]) throw new Error('float render targets unavailable');
    this.pool = [];
    this.poolUsed = 0;
    this.canvases = [];
    for (let i = 0; i < canvasLayers; i++) this.canvases.push(this.makeCanvas());
    this.planes = {};
    this.spriteTex = new WeakMap();
    this.stats = { layers: 0 };
  }

  target(w, h, fmt, type) {
    const gl = this.gl;
    fmt = fmt ?? gl.RGBA16F; type = type ?? gl.HALF_FLOAT;
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, fmt, w, h, 0, gl.RGBA, type, null);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return ok ? { t, fb, w, h } : null;
  }

  // full-resolution scratch buffers for groups, reused frame to frame
  acquire() {
    if (this.poolUsed >= this.pool.length) this.pool.push(this.target(this.iw, this.ih));
    return this.pool[this.poolUsed++];
  }
  release(n = 1) { this.poolUsed -= n; }

  makeTex(minF, magF) {
    const gl = this.gl;
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, minF ?? gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, magF ?? gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  makeCanvas() {
    const c = document.createElement('canvas');
    c.width = this.iw; c.height = this.ih;
    c.__scale = this.scale;
    return { ctx: c.getContext('2d'), tex: this.makeTex(), stamp: undefined };
  }

  upload(tex, source, mip = false) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    if (mip) {
      gl.generateMipmap(gl.TEXTURE_2D);
      if (this.aniso) gl.texParameterf(gl.TEXTURE_2D, this.aniso.TEXTURE_MAX_ANISOTROPY_EXT, 8);
    }
  }

  bind(target) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fb : null);
    gl.viewport(0, 0, target ? target.w : this.iw, target ? target.h : this.ih);
  }

  setBlend(mode = 'normal') {
    const gl = this.gl;
    gl.enable(gl.BLEND);
    (BLENDS[mode] || BLENDS.normal)(gl);
  }

  // ------------------------------------------------------------------ compositing primitives
  // draw texture `tex` (size tw x th internal px; flip = rows bottom-up) into the bound target
  composite(tex, { tw = this.iw, th = this.ih, texScale = this.scale, flip = false, alpha = 1, xform = null, mask = null, tint = null, blend = 'normal' } = {}) {
    const gl = this.gl;
    const { p, u } = this.P.comp;
    gl.useProgram(p);
    this.setBlend(blend);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(u.uTex, 0);
    gl.uniform2f(u.uRes, this.iw, this.ih);
    gl.uniform2f(u.uTexRes, tw, th);
    gl.uniform1f(u.uScale, this.scale);
    gl.uniform1f(u.uTexScale, texScale);
    gl.uniform1f(u.uFlip, flip ? 1 : 0);
    gl.uniform1f(u.uAlpha, alpha);
    const X = xform || [1, 0, 0, 0, 1, 0];
    gl.uniform3f(u.uXa, X[0], X[1], X[2]);
    gl.uniform3f(u.uXb, X[3], X[4], X[5]);
    const m = mask ? maskUniforms(mask, this.W, this.H) : { type: 0, a: [0, 0, 0, 0], b: [0, 0, 0, 0], inv: 0 };
    gl.uniform1f(u.uMaskType, m.type);
    gl.uniform4fv(u.uMaskA, m.a);
    gl.uniform4fv(u.uMaskB, m.b);
    gl.uniform1f(u.uMaskInv, m.inv);
    const T = tint ? [...hexToRgb01(tint.color || tint), tint.amount ?? 1] : [1, 1, 1, 0];
    gl.uniform4fv(u.uTint, T);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  // blur a texture into a half-resolution GL-native buffer; returns that buffer
  blurTex(tex, flip, radius) {
    const gl = this.gl;
    const [a, b] = this.half;
    gl.disable(gl.BLEND);
    this.bind(a);
    let P = this.P.down;
    gl.useProgram(P.p);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(P.u.uTex, 0); gl.uniform2f(P.u.uRes, a.w, a.h); gl.uniform1f(P.u.uFlip, flip ? 1 : 0);
    gl.uniform2f(P.u.uStep, 1 / this.iw, 1 / this.ih); gl.uniform1f(P.u.uThresh, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    const sig = radius * this.scale / 2;
    const iters = sig > 8 ? 2 : 1;
    const step = sig / 2 / Math.sqrt(iters);
    P = this.P.blur;
    gl.useProgram(P.p);
    for (let i = 0; i < iters; i++) {
      this.bind(b); gl.bindTexture(gl.TEXTURE_2D, a.t); gl.uniform1i(P.u.uTex, 0); gl.uniform2f(P.u.uRes, a.w, a.h); gl.uniform2f(P.u.uDir, step / a.w, 0); gl.drawArrays(gl.TRIANGLES, 0, 3);
      this.bind(a); gl.bindTexture(gl.TEXTURE_2D, b.t); gl.uniform1i(P.u.uTex, 0); gl.uniform2f(P.u.uRes, a.w, a.h); gl.uniform2f(P.u.uDir, 0, step / a.h); gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    return a;
  }

  // ------------------------------------------------------------------ layers
  drawStack(layers, target, jit, t) {
    for (const L of layers) {
      if (!L || L.visible === false || (L.alpha ?? 1) <= 0.0005) continue;
      this.stats.layers++;
      switch (L.type) {
        case 'fill': this.drawFill(L, target); break;
        case 'shader': this.drawShader(L, target, jit, t); break;
        case 'canvas': this.drawCanvas(L, target, jit); break;
        case 'image': this.drawImage(L, target, jit); break;
        case 'plane': this.drawPlane(L, target, jit); break;
        case 'three': this.drawThree(L, target, jit, t); break;
        case 'group': this.drawGroup(L, target, jit, t); break;
        default: throw new Error(`unknown layer type "${L.type}"`);
      }
    }
  }

  drawFill(L, target) {
    const gl = this.gl;
    this.bind(target);
    const { p, u } = this.P.fill;
    gl.useProgram(p);
    this.setBlend(L.blend);
    const a = L.alpha ?? 1;
    const c = hexToRgb01(L.color || '#000000');
    gl.uniform4f(u.uColor, c[0] * a, c[1] * a, c[2] * a, a);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  shaderProgram(code, uniforms) {
    const key = code + '\n//' + Object.entries(uniforms).map(([k, v]) => k + ':' + (Array.isArray(v) ? v.length : typeof v)).join(',');
    let P = this.shaderCache.get(key);
    if (!P) {
      P = program(this.gl, VS_FULL, `${HEADER}
uniform vec2 uRes;
uniform vec2 uFmt;
uniform float uScale;
uniform float uTime;
uniform vec2 uJit;
uniform float uAlpha;
${LIB}
${uniformDecl(uniforms)}
${code}
out vec4 o;
void main() {
  vec2 px = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) / uScale + uJit;
  o = shade(px) * uAlpha;
}`);
      this.shaderCache.set(key, P);
    }
    return P;
  }

  drawShader(L, target, jit, t) {
    const gl = this.gl;
    const pre = L.preset ? SHADERS[L.preset] : null;
    if (L.preset && !pre) throw new Error(`unknown shader preset "${L.preset}"`);
    const uniforms = { ...(pre?.uniforms || {}), ...(L.uniforms || {}) };
    const { p, u } = this.shaderProgram(pre ? pre.code : L.code, uniforms);
    this.bind(target);
    gl.useProgram(p);
    this.setBlend(L.blend);
    gl.uniform2f(u.uRes, this.iw, this.ih);
    gl.uniform2f(u.uFmt, this.W, this.H);
    gl.uniform1f(u.uScale, this.scale);
    gl.uniform1f(u.uTime, L.time ?? t);
    gl.uniform2f(u.uJit, jit[0] / this.scale, jit[1] / this.scale);
    gl.uniform1f(u.uAlpha, L.alpha ?? 1);
    for (const [k, v] of Object.entries(uniforms)) setUniform(gl, u[k], v);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  drawCanvas(L, target, jit) {
    if (this.ci >= this.canvases.length) this.canvases.push(this.makeCanvas());
    const slot = this.canvases[this.ci++];
    const cached = L.stamp !== undefined && slot.stamp === L.stamp;
    if (!cached) {
      const ctx = slot.ctx;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, this.iw, this.ih);
      ctx.save();
      const j = L.stamp !== undefined ? [0, 0] : jit;
      ctx.setTransform(this.scale, 0, 0, this.scale, -j[0], -j[1]);
      L.draw(ctx);
      ctx.restore();
      this.upload(slot.tex, ctx.canvas);
      slot.stamp = L.stamp;
    }
    this.bind(target);
    if ((L.blur || 0) > 0.4) {
      const b = this.blurTex(slot.tex, false, L.blur);
      this.bind(target);
      this.composite(b.t, { tw: b.w, th: b.h, texScale: this.scale / 2, flip: true, alpha: L.alpha ?? 1, blend: L.blend });
    } else {
      this.composite(slot.tex, { alpha: L.alpha ?? 1, blend: L.blend, tint: L.tint });
    }
  }

  // free the GPU copy of an image that will not be drawn again (sequence frames)
  releaseImage(img) {
    const T = this.spriteTex.get(img);
    if (T) { this.gl.deleteTexture(T); this.spriteTex.delete(img); }
  }

  imageTexture(img) {
    let T = this.spriteTex.get(img);
    if (!T) {
      const gl = this.gl;
      T = this.makeTex(gl.LINEAR_MIPMAP_LINEAR, gl.LINEAR);
      this.upload(T, img, true);
      this.spriteTex.set(img, T);
    }
    return T;
  }

  drawImage(L, target, jit) {
    const gl = this.gl;
    const img = L.img;
    if (!img) return;
    const tex = this.imageTexture(img);
    const iwid = img.naturalWidth || img.width, ihei = img.naturalHeight || img.height;
    const crop = L.crop || [0, 0, 1, 1];
    const w = L.w ?? (L.h ? L.h * iwid * (crop[2] - crop[0]) / (ihei * (crop[3] - crop[1])) : iwid * (crop[2] - crop[0]));
    const h = L.h ?? w * ihei * (crop[3] - crop[1]) / (iwid * (crop[2] - crop[0]));
    const anchor = L.anchor || [0.5, 0.5];
    this.bind(target);
    const { p, u } = this.P.sprite;
    gl.useProgram(p);
    this.setBlend(L.blend);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(u.uTex, 0);
    gl.uniform2f(u.uFmt, this.W, this.H);
    gl.uniform2f(u.uJit, jit[0] / this.scale, jit[1] / this.scale);
    gl.uniform4f(u.uRect, L.x ?? this.W / 2, L.y ?? this.H / 2, w * (L.flipX ? -1 : 1), h);
    gl.uniform4f(u.uXf, anchor[0], anchor[1], L.rot || 0, 0);
    gl.uniform4f(u.uDef, L.bend || 0, L.squash ?? 1, L.wave?.[0] || 0, L.wave?.[1] || 1);
    gl.uniform4f(u.uDef2, L.wave?.[2] || 0, L.skew || 0, 0, 0);
    gl.uniform4fv(u.uCrop, crop);
    const grid = L.bend || L.wave || (L.squash ?? 1) !== 1 ? 16 : 1;
    gl.uniform1f(u.uGrid, grid);
    gl.uniform1f(u.uAlpha, L.alpha ?? 1);
    const T = L.tint ? [...hexToRgb01(L.tint.color || L.tint), L.tint.amount ?? 1] : [1, 1, 1, 0];
    gl.uniform4fv(u.uTint, T);
    gl.uniform1f(u.uBright, L.bright ?? 1);
    gl.drawArrays(gl.TRIANGLES, 0, grid * grid * 6);
  }

  plane(name, w, h) {
    let P = this.planes[name];
    if (!P || P.w !== w || P.h !== h) {
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      c.__plane = true;
      P = { ctx: c.getContext('2d'), w, h, tex: this.makeTex(this.gl.LINEAR_MIPMAP_LINEAR, this.gl.LINEAR) };
      this.planes[name] = P;
    }
    return P;
  }

  // the plane's texture is redrawn once per stamp (or every sub-frame without one); its placement
  // is evaluated per sub-frame for motion blur
  drawPlane(L, target, jit) {
    const gl = this.gl;
    const P = this.plane(L.name || 'plane', L.tw, L.th);
    if (L.stamp === undefined || P.stamp !== L.stamp) {
      const ctx = P.ctx;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, P.w, P.h);
      ctx.save();
      L.draw(ctx);
      ctx.restore();
      this.upload(P.tex, ctx.canvas, true);
      P.stamp = L.stamp;
    }
    this.bind(target);
    const { p, u } = this.P.plane;
    gl.useProgram(p);
    this.setBlend(L.blend);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, P.tex);
    gl.uniform1i(u.uTex, 0);
    gl.uniform2f(u.uFmt, this.W, this.H);
    gl.uniform2f(u.uJit, jit[0] / this.scale, jit[1] / this.scale);
    gl.uniform4f(u.uPos, L.x, L.y, L.z || 0, L.focal || 2400);
    gl.uniform4f(u.uSize, L.w, L.h, L.pivotZ || 0, L.pivotY || 0);
    gl.uniform3f(u.uRot, L.rx || 0, L.ry || 0, L.rz || 0);
    gl.uniform1f(u.uAlpha, L.alpha ?? 1);
    gl.uniform4f(u.uSheen, L.sheen?.[0] ?? 0, L.sheen?.[1] ?? 0, L.sheen?.[2] ?? 0.2, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  drawThree(L, target, jit, t) {
    const src = L.layer.render(t, [jit[0] / this.scale, jit[1] / this.scale], this);
    if (!this.threeTex) this.threeTex = this.makeTex();
    this.upload(this.threeTex, src);
    this.gl.bindVertexArray(this.vao);
    this.bind(target);
    this.composite(this.threeTex, { alpha: L.alpha ?? 1, blend: L.blend, tint: L.tint });
  }

  drawGroup(L, target, jit, t) {
    const gl = this.gl;
    const inner = this.acquire();
    this.bind(inner);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    this.drawStack(L.layers || [], inner, jit, t);
    let src = inner, used = 1;
    const chain = L.fx ? normChain(L.fx) : [];
    if (chain.length) {
      const out = this.acquire();
      used++;
      this.bind(out);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.disable(gl.BLEND);
      this.runChain(chain, 'group', inner.t, t, {});
      src = out;
    }
    const xform = L.transform ? inverseXform(L.transform, this.W, this.H) : null;
    if ((L.blur || 0) > 0.4) {
      const b = this.blurTex(src.t, true, L.blur);
      this.bind(target);
      this.composite(b.t, { tw: b.w, th: b.h, texScale: this.scale / 2, flip: true, alpha: L.alpha ?? 1, xform, mask: L.mask, blend: L.blend, tint: L.tint });
    } else {
      this.bind(target);
      this.composite(src.t, { flip: true, alpha: L.alpha ?? 1, xform, mask: L.mask, blend: L.blend, tint: L.tint });
    }
    this.release(used);
  }

  // ------------------------------------------------------------------ post
  chainProgram(chain, mode) {
    const key = mode + ':' + chainKey(chain);
    let P = this.chainCache.get(key);
    if (!P) {
      P = program(this.gl, VS_FULL, chainSource(chain, mode));
      this.chainCache.set(key, P);
    }
    return P;
  }

  // draw the chain over the bound target, reading `srcTex`
  runChain(chain, mode, srcTex, t, post) {
    const gl = this.gl;
    const { p, u } = this.chainProgram(chain, mode);
    gl.useProgram(p);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, srcTex); gl.uniform1i(u.uSrc, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, post.bloomTex || srcTex); gl.uniform1i(u.uBloom, 1);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform2f(u.uRes, this.iw, this.ih);
    gl.uniform2f(u.uFmt, this.W, this.H);
    gl.uniform1f(u.uScale, this.scale);
    gl.uniform1f(u.uTime, t);
    gl.uniform1f(u.uExposure, post.exposure ?? 1);
    gl.uniform1f(u.uBloomAmt, post.bloomTex ? post.bloomAmt : 0);
    const fd = post.fade ? hexToRgb01(post.fade.color || '#000000').map(c => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)) : [0, 0, 0];
    gl.uniform4f(u.uFade, fd[0], fd[1], fd[2], post.fade?.a || 0);
    gl.uniform1f(u.uAlphaOut, this.alphaOut ? 1 : 0);
    gl.uniform1f(u.uAlpha, 1);
    setChainUniforms(gl, u, chain);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  bloom(post) {
    const gl = this.gl;
    const B = post.bloom;
    if (!B || !(B.amount > 0)) return null;
    const [a, b] = this.bloomT;
    gl.disable(gl.BLEND);
    this.bind(a);
    let P = this.P.down;
    gl.useProgram(P.p);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.acc.t);
    gl.uniform1i(P.u.uTex, 0); gl.uniform2f(P.u.uRes, a.w, a.h); gl.uniform1f(P.u.uFlip, 1);
    gl.uniform2f(P.u.uStep, 1.5 / this.iw, 1.5 / this.ih); gl.uniform1f(P.u.uThresh, B.threshold ?? 0.8);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    P = this.P.blur;
    gl.useProgram(P.p);
    const r = (B.radius ?? 24) * this.scale / 4 / 3;
    for (const s of [1, 2]) {
      this.bind(b); gl.bindTexture(gl.TEXTURE_2D, a.t); gl.uniform1i(P.u.uTex, 0); gl.uniform2f(P.u.uRes, a.w, a.h); gl.uniform2f(P.u.uDir, r * s / a.w, 0); gl.drawArrays(gl.TRIANGLES, 0, 3);
      this.bind(a); gl.bindTexture(gl.TEXTURE_2D, b.t); gl.uniform1i(P.u.uTex, 0); gl.uniform2f(P.u.uRes, a.w, a.h); gl.uniform2f(P.u.uDir, 0, r * s / a.h); gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    return a.t;
  }

  // ------------------------------------------------------------------ one output frame
  render(t, build, { samples = 8, shutter = 0.5, fps = 60 } = {}) {
    const gl = this.gl;
    gl.bindVertexArray(this.vao);
    this.bind(this.acc);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    this.stats.layers = 0;
    let last = null;
    for (let k = 0; k < samples; k++) {
      const tk = samples > 1 ? t + ((k + 0.5) / samples - 0.5) * shutter / fps : t;
      let S = build(tk, t);
      if (Array.isArray(S)) S = { layers: S };
      const jit = samples > 1 ? [halton(k, 2) - 0.5, halton(k, 3) - 0.5] : [0, 0];
      this.bind(this.sub);
      gl.clearColor(0, 0, 0, this.alphaOut ? 0 : 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      this.ci = 0;
      this.poolUsed = 0;
      this.drawStack(S.layers || [], this.sub, jit, tk);
      gl.bindVertexArray(this.vao);
      this.bind(this.acc);
      gl.enable(gl.BLEND);
      gl.blendEquation(gl.FUNC_ADD);
      gl.blendFunc(gl.ONE, gl.ONE);
      const { p, u } = this.P.acc;
      gl.useProgram(p);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.sub.t);
      gl.uniform1i(u.uTex, 0);
      gl.uniform2f(u.uRes, this.iw, this.ih);
      gl.uniform1f(u.uW, 1 / samples);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      last = S;
    }
    const post = { ...(last.post || {}) };
    const bloomTex = this.bloom(post);
    if (bloomTex) { post.bloomTex = bloomTex; post.bloomAmt = post.bloom.amount; }
    gl.disable(gl.BLEND);
    this.bind(null);
    this.runChain(normChain(post.looks || []), 'final', this.acc.t, t, post);
    return last;
  }
}

// inverse of: translate to (x, y), rotate rot, scale, about anchor (format px) -> maps output px to source px
export function inverseXform({ x = 0, y = 0, scale = 1, sx, sy, rot = 0, anchor } = {}, W, H) {
  const [ax, ay] = anchor || [W / 2, H / 2];
  const kx = sx ?? scale, ky = sy ?? scale;
  const c = Math.cos(-rot), s = Math.sin(-rot);
  // p' = R(rot) * S * (p - a) + a + (x, y)  =>  p = S^-1 R(-rot) (p' - a - (x, y)) + a
  const ox = -ax - x, oy = -ay - y;
  return [
    c / kx, -s / kx, (c * ox - s * oy) / kx + ax,
    s / ky, c / ky, (s * ox + c * oy) / ky + ay,
  ];
}

function maskUniforms(M, W, H) {
  const type = MASKS[M.type] ?? 0;
  const inv = M.invert ? 1 : 0;
  if (M.type === 'wipe') {
    const ang = M.angle ?? 0;                       // 0 = reveal left to right
    const dx = Math.cos(ang), dy = Math.sin(ang);
    // p = 0..1 sweeps across the frame along the direction
    const span = Math.abs(dx) * W + Math.abs(dy) * H;
    const start = Math.min(0, dx * W) + Math.min(0, dy * H);
    const f = M.feather ?? 40;
    return { type, inv, a: [dx, dy, start - f + (span + 2 * f) * (M.p ?? 0), f], b: [0, 0, 0, 0] };
  }
  if (M.type === 'iris') return { type, inv, a: [M.x ?? W / 2, M.y ?? H / 2, M.r ?? 0, M.feather ?? 2], b: [0, 0, 0, 0] };
  if (M.type === 'rect') return { type, inv, a: [M.x0, M.y0, M.x1, M.y1], b: [M.feather ?? 1, M.radius ?? 0, 0, 0] };
  if (M.type === 'clock') return { type, inv, a: [M.x ?? W / 2, M.y ?? H / 2, M.start ?? 0, M.p ?? 0], b: [M.feather ?? 0.01, 0, 0, 0] };
  return { type: 0, inv, a: [0, 0, 0, 0], b: [0, 0, 0, 0] };
}
