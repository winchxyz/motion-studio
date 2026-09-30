// 3D inside the film: a Three.js scene rendered per sub-frame (so it gets the engine's motion blur and
// anti-aliasing) and composited like any other layer. Everything in update(t) must be a function of t.
//
//   import { ThreeLayer, THREE, textMesh, chrome } from '/studio/engine/three-layer.js';
//   const L3 = new ThreeLayer(ctx.engine, {
//     setup(L, THREE) { L.camera.position.set(0, 0, 8); L.scene.add(L.logo = new THREE.Mesh(geo, chrome())); },
//     update(t, L) { L.logo.rotation.y = t * 0.8; },
//   });
//   build: layers.push({ type: 'three', layer: L3 })
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { SVGLoader } from 'three/addons/loaders/SVGLoader.js';
import * as opentype from 'opentype';

export { THREE };

const TONE = { aces: THREE.ACESFilmicToneMapping, agx: THREE.AgXToneMapping, neutral: THREE.NeutralToneMapping, none: THREE.NoToneMapping };

export class ThreeLayer {
  constructor(engine, { setup = null, update = null, fov = 30, near = 0.1, far = 500, tone = 'agx', exposure = 1, shadows = false, env = 'room', envIntensity = 1 } = {}) {
    this.W = engine.W; this.H = engine.H;
    const canvas = document.createElement('canvas');
    canvas.width = engine.iw; canvas.height = engine.ih;
    const r = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: true, premultipliedAlpha: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
    r.setPixelRatio(1);
    r.setSize(engine.iw, engine.ih, false);
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = TONE[tone] ?? THREE.AgXToneMapping;
    r.toneMappingExposure = exposure;
    r.setClearColor(0x000000, 0);
    if (shadows) { r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap; }
    this.renderer = r;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(fov, engine.W / engine.H, near, far);
    if (env === 'room') {
      const pm = new THREE.PMREMGenerator(r);
      this.scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
      this.scene.environmentIntensity = envIntensity;
      pm.dispose();
    }
    this.update = update;
    this.ready = Promise.resolve(setup?.(this, THREE));
  }
  // called by the engine once per sub-frame; jit is the anti-aliasing offset in format px
  render(t, jit = [0, 0]) {
    this.update?.(t, this, THREE);
    const cam = this.camera;
    cam.setViewOffset(this.W, this.H, jit[0], jit[1], this.W, this.H);
    this.renderer.render(this.scene, cam);
    return this.renderer.domElement;
  }
}

// ---------------------------------------------------------------- materials
export const chrome = (o = {}) => new THREE.MeshPhysicalMaterial({ color: 0xffffff, metalness: 1, roughness: 0.08, envMapIntensity: 1.2, ...o });
export const glass = (o = {}) => new THREE.MeshPhysicalMaterial({ color: 0xffffff, metalness: 0, roughness: 0.05, transmission: 1, thickness: 0.6, ior: 1.45, iridescence: 0.2, ...o });
export const clay = (color = '#e9e2d6', o = {}) => new THREE.MeshStandardMaterial({ color: new THREE.Color(color), roughness: 0.85, metalness: 0, ...o });
export const plastic = (color = '#ff6a1a', o = {}) => new THREE.MeshPhysicalMaterial({ color: new THREE.Color(color), roughness: 0.32, clearcoat: 0.6, clearcoatRoughness: 0.2, ...o });
export const toon = (color = '#ff6a1a', o = {}) => new THREE.MeshToonMaterial({ color: new THREE.Color(color), ...o });

// ---------------------------------------------------------------- geometry
// 3D type from any TTF/OTF: glyph outlines -> shapes -> extrusion. size in world units.
const fontCache = new Map();
export async function loadFont(url) {
  if (!fontCache.has(url)) fontCache.set(url, fetch(encodeURI(url)).then(r => r.arrayBuffer()).then(b => opentype.parse(b)));
  return fontCache.get(url);
}
export function textShapes(font, str, size = 1, { letterSpacing = 0 } = {}) {
  // glyph by glyph with kerning, no shaping: opentype.js cannot run some chaining substitutions
  // (Inter's among them), and display type needs no ligatures
  const scale = 100 / font.unitsPerEm;
  let x = 0, prev = null, d = '';
  for (const ch of String(str)) {
    const g = font.charToGlyph(ch);
    if (prev) x += font.getKerningValue(prev, g) * scale;
    d += g.getPath(x, 0, 100).toPathData(3) + ' ';
    x += g.advanceWidth * scale + letterSpacing;
    prev = g;
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg"><path d="${d}"/></svg>`;
  const data = new SVGLoader().parse(svg);
  const shapes = [];
  for (const p of data.paths) shapes.push(...SVGLoader.createShapes(p));
  const k = size / 100;
  return { shapes, k };
}
export async function textMesh(fontUrl, str, { size = 1, depth = 0.25, bevel = 0.02, curveSegments = 10, material = null, center = true, letterSpacing = 0 } = {}) {
  const font = await loadFont(fontUrl);
  const { shapes, k } = textShapes(font, str, size, { letterSpacing });
  const geo = new THREE.ExtrudeGeometry(shapes, { depth: depth / k, bevelEnabled: bevel > 0, bevelThickness: bevel / k, bevelSize: bevel / k * 0.8, bevelSegments: 4, curveSegments });
  geo.scale(k, -k, k);                         // SVG y is down
  if (center) { geo.computeBoundingBox(); const b = geo.boundingBox; geo.translate(-(b.min.x + b.max.x) / 2, -(b.min.y + b.max.y) / 2, -(b.min.z + b.max.z) / 2); }
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, material || chrome());
}
// extrude SVG path data (a logo mark) to a given height in world units
export function svgMesh(d, { height = 1, depth = 0.25, bevel = 0.02, material = null, curveSegments = 16, center = true } = {}) {
  const data = new SVGLoader().parse(`<svg xmlns="http://www.w3.org/2000/svg"><path d="${d}"/></svg>`);
  const shapes = [];
  for (const p of data.paths) shapes.push(...SVGLoader.createShapes(p));
  const probe = new THREE.ShapeGeometry(shapes);
  probe.computeBoundingBox();
  const bh = probe.boundingBox.max.y - probe.boundingBox.min.y || 1;
  probe.dispose();
  const k = height / bh;
  const geo = new THREE.ExtrudeGeometry(shapes, { depth: depth / k, bevelEnabled: bevel > 0, bevelThickness: bevel / k, bevelSize: bevel / k * 0.8, bevelSegments: 4, curveSegments });
  geo.scale(k, -k, k);
  if (center) { geo.computeBoundingBox(); const b = geo.boundingBox; geo.translate(-(b.min.x + b.max.x) / 2, -(b.min.y + b.max.y) / 2, -(b.min.z + b.max.z) / 2); }
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, material || chrome());
}
export async function loadGLTF(url) {
  return new Promise((res, rej) => new GLTFLoader().load(encodeURI(url), res, undefined, rej));
}

// a light rig that reads well on product shapes: key, rim, fill (world units, looking at the origin)
export function studioLights(scene, { key = 2.2, rim = 3.0, fill = 0.5, color = '#ffffff', shadows = false } = {}) {
  const k = new THREE.DirectionalLight(color, key); k.position.set(4, 5, 6); k.castShadow = shadows;
  const r = new THREE.DirectionalLight(color, rim); r.position.set(-5, 2, -4);
  const f = new THREE.HemisphereLight('#ffffff', '#303040', fill);
  scene.add(k, r, f);
  return { key: k, rim: r, fill: f };
}
