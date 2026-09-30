// 3D test: chrome type extruded from a TTF, an instanced voxel wave, a chrome sphere with a ring.
import { E, clamp, track } from '/studio/engine/util.js';
import { ThreeLayer, THREE, textMesh, chrome, plastic, studioLights } from '/studio/engine/three-layer.js';
import { font, text } from '/studio/engine/text.js';

let L3;
const N = 22;

export default {
  fonts: [{ family: 'Geist Mono', src: '/studio/fonts/GeistMono-VariableFont_wght.ttf', weight: '100 900' }],
  async init(ctx) {
    L3 = new ThreeLayer(ctx.engine, {
      fov: ctx.F.portrait ? 42 : 30,
      async setup(L, T) {
        studioLights(L.scene, { key: 2.4, rim: 3.2, fill: 0.35 });
        // voxel field
        const box = new T.BoxGeometry(0.9, 1, 0.9);
        const mat = plastic('#ff5b2e', { roughness: 0.45 });
        L.vox = new T.InstancedMesh(box, mat, N * N);
        L.vox.position.set(0, -2.2, 0);
        L.scene.add(L.vox);
        L.dummy = new T.Object3D();
        L.col = new T.Color();
        // chrome sphere + ring
        L.ball = new T.Mesh(new T.SphereGeometry(1.1, 96, 64), chrome());
        L.ring = new T.Mesh(new T.TorusGeometry(1.75, 0.035, 16, 200), chrome({ roughness: 0.15 }));
        L.scene.add(L.ball, L.ring);
        // extruded type
        L.word = await textMesh('/studio/fonts/InterDisplay-Bold.ttf', 'Claude', { size: 1.6, depth: 0.45, bevel: 0.035, material: chrome({ roughness: 0.12 }) });
        L.scene.add(L.word);
      },
      update(t, L, T) {
        const cam = L.camera;
        const orbit = track(t, [[0, -0.6], [4, 0.5, E.inOutSine]]);
        cam.position.set(Math.sin(orbit) * 16, 7.5, Math.cos(orbit) * 16);
        cam.lookAt(0, 0, 0);
        let i = 0;
        for (let x = 0; x < N; x++) for (let z = 0; z < N; z++) {
          const px = x - N / 2 + 0.5, pz = z - N / 2 + 0.5;
          const r = Math.hypot(px, pz);
          const h = 0.6 + 1.4 * (0.5 + 0.5 * Math.sin(r * 0.55 - t * 3.2)) * Math.exp(-r * 0.06);
          L.dummy.position.set(px, h / 2 - 1, pz);
          L.dummy.scale.set(1, h, 1);
          L.dummy.updateMatrix();
          L.vox.setMatrixAt(i, L.dummy.matrix);
          L.col.setHSL(0.02 + 0.08 * (h / 2), 0.9, 0.35 + 0.25 * (h / 2));
          L.vox.setColorAt(i++, L.col);
        }
        L.vox.instanceMatrix.needsUpdate = true;
        L.vox.instanceColor.needsUpdate = true;
        const lift = E.snap(clamp(t / 1.2));
        L.ball.position.set(0, 1.6 + 0.25 * Math.sin(t * 2.4), 0);
        L.ring.position.copy(L.ball.position);
        L.ring.rotation.set(1.2 + 0.2 * Math.sin(t), t * 0.9, 0.3);
        L.word.position.set(0, 4.3 - (1 - lift) * 2, 0);
        L.word.rotation.set(-0.25, orbit, 0);
        L.word.scale.setScalar(0.4 + 0.6 * lift);
      },
    });
    await L3.ready;
  },
  build(t, ctx) {
    const F = ctx.F;
    return {
      layers: [
        { type: 'shader', preset: 'radial', uniforms: { center: [F.cx, F.H * 0.45], radius: Math.hypot(F.W, F.H) * 0.6, c0: '#2b2f3a', c1: '#07080b' } },
        { type: 'three', layer: L3 },
        { type: 'canvas', draw: c => { font(c, 500, 22 * F.u, '"Geist Mono"'); text(c, `THREE.JS LAYER  t=${t.toFixed(2)}`, F.safe[0], F.safe[3] - 10, { color: 'rgba(255,255,255,0.6)', track: 3, deco: true }); } },
      ],
      post: { bloom: { amount: 0.35, threshold: 0.9, radius: 30 }, looks: [['grain', { amount: 0.02 }], ['vignette', { amount: 0.25 }]] },
    };
  },
};
