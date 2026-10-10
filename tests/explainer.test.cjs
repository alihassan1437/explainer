// Tests for the Explainer: the same frame every time, timing cues, the scene checks, and that it depends on nothing but React, Next and its own code.
// (The expression language and the agent-written drawings are tested in explainer-drawing.test.cjs.)
const test = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');
const fs = require('node:fs');
const path = require('node:path');

const SRC = path.join(__dirname, '../src');
const EXPLAINER = path.join(SRC, 'explainer');
const cache = new Map();
const resolveTs = base => (fs.existsSync(base + '.ts') ? base + '.ts' : path.join(base, 'index.ts'));
function load(file) {
  const abs = path.resolve(file);
  if (cache.has(abs)) return cache.get(abs).exports;
  const text = fs.readFileSync(abs, 'utf8');
  const output = ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const m = { exports: {} };
  cache.set(abs, m);
  new Function('require', 'module', 'exports', output)(id => (id.startsWith('.') ? load(resolveTs(path.resolve(path.dirname(abs), id))) : require(id)), m, m.exports);
  return m.exports;
}
const ex = p => load(path.join(EXPLAINER, p));
const timing = ex('timing.ts'), schema = ex('schema.ts'), theme = ex('theme.ts'), frame = ex('draw/frame.ts'), layout = ex('draw/layout.ts'), prim = ex('draw/primitives.ts'), sample = ex('sample.ts');
const reference = load(path.join(__dirname, 'fixtures/engine-reference.ts'));

/** A canvas context that records every call, so two frames can be compared exactly. */
function recorder() {
  const log = [], props = {};
  const ctx = new Proxy({}, {
    get(_, key) {
      if (key in props) return props[key];
      if (key === 'measureText') return text => ({ width: String(text).length * (Number((/(\d+(?:\.\d+)?)px/.exec(props.font || '') || [0, 16])[1]) * 0.55) });
      if (/^create.*Gradient$/.test(String(key))) return (...a) => { log.push([key, ...a]); return { addColorStop: (...s) => log.push(['stop', ...s]) }; };
      return (...a) => { log.push([String(key), ...a]); };
    },
    set(_, key, value) { props[key] = value; log.push(['set ' + String(key), value]); return true; },
  });
  return { ctx, log };
}
const render = (project, t, w = 960, h = 540) => { const r = recorder(); frame.drawFrame(r.ctx, project, t, w, h); return JSON.stringify(r.log); };
const engineProject = sample.SAMPLES[0].project;

test('a frame is a pure function of time: same time, same picture; never random, never the clock', () => {
  const realRandom = Math.random, realNow = Date.now;
  Math.random = () => { throw new Error('Math.random was used'); };
  Date.now = () => { throw new Error('Date.now was used'); };
  try {
    for (const s of sample.SAMPLES) for (const t of [0, 1500, 5000, 12000, 20500, 33333, 44000]) assert.equal(render(s.project, t), render(s.project, t), `${s.id} t=${t}`);
  } finally { Math.random = realRandom; Date.now = realNow; }
  assert.notEqual(render(engineProject, 12000), render(engineProject, 12400), 'time changes the picture');
  assert.notEqual(render({ ...engineProject, theme: 'flat' }, 12000), render(engineProject, 12000), 'the theme changes the picture');
  assert.doesNotThrow(() => { render(engineProject, -500); render(engineProject, 999999); render({ ...engineProject, aspect: '9:16' }, 15000, 540, 960); });
});

test('the title and list blocks draw, in both shapes, at every moment of their length', () => {
  const project = { aspect: '16:9', theme: 'blueprint', scenes: [{ block: 'title', text: 'A fairly long headline about how things work', subtitle: 'and a subtitle' }, { block: 'bullets', title: 'Steps', items: ['one', 'two', 'three'] }] };
  const total = timing.layoutTimeline(project).totalMs;
  for (const [w, h] of [[960, 540], [540, 960]]) for (let t = 0; t <= total; t += 250) assert.doesNotThrow(() => render(project, t, w, h), `${w}x${h} at ${t}`);
  assert.ok(render(project, 1500).includes('fillText'), 'words are drawn');
  const noWords = recorder(); frame.drawFrame(noWords.ctx, project, 0, 960, 540);
  assert.ok(!noWords.log.some(l => l[0] === 'fillText'), 'nothing is drawn before the first word arrives');
});

test('the reference engine: the piston follows the crank formula and the rod never changes length', () => {
  const { R, L } = reference.G;
  const at = deg => reference.engineState(deg);
  assert.ok(Math.abs(at(0).pistonPinY - (R + L)) < 1e-9, 'top at 0');
  assert.ok(Math.abs(at(180).pistonPinY - (L - R)) < 1e-9, 'bottom at 180');
  assert.ok(Math.abs(at(360).pistonPinY - (R + L)) < 1e-9, 'top again at 360');
  assert.ok(Math.abs(at(540).pistonPinY - (L - R)) < 1e-9, 'bottom at 540');
  for (let d = 0; d < 720; d += 7) {
    const s = at(d);
    assert.ok(Math.abs(Math.hypot(s.crankPin[0] - 0, s.crankPin[1] - s.pistonPinY) - L) < 1e-9, `rod length at ${d}`);
    assert.ok(Math.abs(Math.hypot(...s.crankPin) - R) < 1e-9, `crank radius at ${d}`);
  }
  let prev = at(0).pistonPinY;
  for (let d = 5; d <= 180; d += 5) { const y = at(d).pistonPinY; assert.ok(y < prev, `going down at ${d}`); prev = y; }
  for (let d = 185; d <= 360; d += 5) { const y = at(d).pistonPinY; assert.ok(y > prev, `going up at ${d}`); prev = y; }
});

test('the reference engine: strokes, valves, spark and flame happen at the right crank angles, and the cycle loops', () => {
  const at = deg => reference.engineState(deg);
  assert.deepEqual([0, 179, 180, 359, 360, 539, 540, 719].map(d => at(d).stroke), [0, 0, 1, 1, 2, 2, 3, 3]);
  assert.ok(at(90).liftIn > 0.17 && at(90).liftEx < 0.01, 'intake valve fully open in the middle of the intake stroke');
  assert.ok(at(630).liftEx > 0.17 && at(630).liftIn < 0.01, 'exhaust valve fully open in the middle of the exhaust stroke');
  for (let d = 200; d <= 520; d += 10) assert.ok(at(d).liftIn < 0.01 && at(d).liftEx < 0.01, `both valves closed at ${d}`);
  assert.ok(at(364).spark > 0.9 && at(300).spark === 0 && at(420).spark === 0, 'the spark fires at the top of compression only');
  assert.ok(at(380).flame > 0.5 && at(300).flame === 0 && at(560).flame === 0 && at(540).flame === 0, 'flame only in the power stroke');
  for (const d of [3, 100, 361, 600]) {
    const a = at(d), b = at(d + 720);
    assert.equal(b.cycleIndex, a.cycleIndex + 1);
    for (const k of ['pistonPinY', 'liftIn', 'liftEx', 'spark', 'flame', 'stroke']) assert.ok(Math.abs(a[k] - b[k]) < 1e-9, `${k} repeats every 720 at ${d}`);
  }
  assert.equal(at(-90).cycleDeg, 630, 'negative angles wrap');
  assert.ok(Math.abs(at(0).camIn - (-Math.PI / 4)) < 1e-9 && Math.abs(at(180).camIn - Math.PI / 4) < 1e-9, 'the camshaft turns once for two crank turns');
});

test('the reference engine: gas comes in with the intake valve, stays inside while sealed, and leaves with the exhaust valve', () => {
  const one = { u: 0.6, v: 0.5, enter: 85, exit: 600, w1: 4, w2: 4, p1: 0, p2: 0 };
  for (const cycle of [0, 1, 7]) {
    for (const deg of [0, 5, 719.9]) assert.ok(reference.gasParticle(one, reference.engineState(cycle * 720 + deg), 1).alpha < 0.05, `no gas visible at ${deg}`);
    for (const deg of [200, 300, 400, 520]) {
      const s = reference.engineState(cycle * 720 + deg), p = reference.gasParticle(one, s, 2.5);
      assert.equal(p.alpha, 1, `gas present at ${deg}`);
      assert.ok(Math.abs(p.x) <= 0.9 && p.y > s.pistonTopY - 1e-9 && p.y < reference.HEAD_Y + 1e-9, `inside the chamber at ${deg}`);
    }
  }
  const entering = reference.gasParticle({ ...one, enter: 60, u: 0 }, reference.engineState(70), 0);
  assert.ok(entering.alpha > 0 && entering.alpha < 1 && entering.x < 0, 'on its way in through the left (intake) side');
  const leaving = reference.gasParticle({ ...one, u: 0 }, reference.engineState(615), 0);
  assert.ok(leaving.alpha > 0 && leaving.x > 0, 'and out through the right (exhaust) side');
});

test('timing: scenes follow one another, and cues resolve to times, spoken words, fractions or nothing', () => {
  const tl = timing.layoutTimeline(engineProject);
  assert.equal(tl.items[0].startMs, 0);
  tl.items.forEach((it, i) => { if (i) assert.equal(it.startMs, tl.items[i - 1].endMs); });
  assert.equal(tl.totalMs, tl.items[tl.items.length - 1].endMs);
  assert.equal(timing.sceneAt(tl.items, 0).index, 0);
  assert.equal(timing.sceneAt(tl.items, tl.totalMs + 5000).index, tl.items.length - 1);
  assert.equal(timing.sceneLengthMs({ block: 'title', text: 'x', lengthMs: 5 }), timing.MIN_SCENE_MS, 'too short is lengthened');
  assert.equal(timing.sceneLengthMs({ block: 'title', text: 'x' }), 3000);

  const scene = { startMs: 10000, endMs: 20000 };
  const words = [{ text: 'The', startMs: 9000, endMs: 9300 }, { text: 'Piston,', startMs: 11000, endMs: 11500 }, { text: 'moves', startMs: 12000, endMs: 12300 }, { text: 'piston', startMs: 15000, endMs: 15400 }, { text: 'piston', startMs: 25000, endMs: 25400 }];
  assert.equal(timing.resolveAt(500, scene, words), 500);
  assert.equal(timing.resolveAt({ frac: 0.25 }, scene, words), 2500);
  assert.equal(timing.resolveAt({ word: 'piston' }, scene, words), 1000, 'punctuation and case are ignored');
  assert.equal(timing.resolveAt({ word: 'piston', occurrence: 2 }, scene, words), 5000);
  assert.equal(timing.resolveAt({ word: 'piston', occurrence: 3 }, scene, words), null, 'a word spoken after the scene does not count');
  assert.equal(timing.resolveAt({ word: 'the' }, scene, words), null, 'a word spoken before the scene does not count');
  assert.equal(timing.resolveAt({ word: 'piston' }, scene, undefined), null, 'no narration, no word times');
  assert.equal(timing.resolveAt(undefined, scene, words), null);
  assert.deepEqual([5, -3, { word: ' hi ' }, { word: '' }, { frac: 3 }, 'x', null, [1]].map(timing.cleanAt), [5, 0, { word: 'hi' }, undefined, { frac: 1 }, undefined, undefined, undefined]);
});

test('themes: one project, two looks, and palette overrides', () => {
  const base = { aspect: '16:9', theme: 'blueprint', scenes: [] };
  assert.notEqual(theme.THEMES.blueprint.palette.bgTop, theme.THEMES.flat.palette.bgTop);
  assert.equal(theme.THEMES.blueprint.filled, false); assert.equal(theme.THEMES.flat.filled, true);
  assert.equal(theme.paletteOf({ ...base, palette: { accent: '#ff0000' } }).accent, '#ff0000');
  assert.equal(theme.paletteOf({ ...base, palette: { accent: '#ff0000' } }).ink, theme.THEMES.blueprint.palette.ink);
  for (const id of ['blueprint', 'flat']) for (const [slot, value] of Object.entries(theme.THEMES[id].palette)) assert.match(value, /^#[0-9a-f]{6}$/i, `${id}.${slot}`);
  assert.notEqual(render(engineProject, 12000), render({ ...engineProject, theme: 'flat' }, 12000));
  assert.ok(render({ ...engineProject, parts: { piston: '#ff6a00' } }, 12000).includes('#ff6a00'), "the user's colour reaches the picture");
});

test('schema: a good project has no problems, bad input is reported with a usable project left over', () => {
  assert.deepEqual(schema.normalizeProject(engineProject).issues, []);
  assert.equal(schema.normalizeProject(engineProject).project.scenes.length, 3);
  const bad = schema.normalizeProject({
    aspect: '4:3', theme: 'neon', palette: { accent: 'blue' }, parts: { piston: 'red', 'bad name': '#ffffff', gear: '#aabbcc' },
    scenes: [
      { block: 'title' }, { block: 'title', text: 'x'.repeat(200), lengthMs: 5 }, { block: 'bullets', items: [] },
      { block: 'bullets', items: Array.from({ length: 12 }, (_, i) => 'Item ' + i) }, { block: 'chart' }, { block: 'mechanism', kind: 'engine' }, 'nope',
    ],
  });
  const text = bad.issues.map(i => `${i.level}:${i.message}`).join('\n');
  assert.match(text, /aspect must be/); assert.match(text, /theme must be/); assert.match(text, /palette\.accent/);
  assert.match(text, /"bad name" is not a valid part name/); assert.match(text, /must look like #ff6a00/);
  assert.match(text, /Scene 1: a title needs "text"/); assert.match(text, /Scene 2: the title is longer than 80/); assert.match(text, /lengthMs was moved to 800/);
  assert.match(text, /Scene 3: a list needs "items"/); assert.match(text, /Scene 4: a list shows at most 7 items/);
  assert.match(text, /the block "chart" does not exist/); assert.match(text, /the block "mechanism" does not exist. Available: title, bullets, drawing/);
  assert.equal(bad.project.aspect, '16:9'); assert.equal(bad.project.theme, 'blueprint');
  assert.deepEqual(bad.project.scenes.map(s => s.block), ['title', 'bullets']);
  assert.equal(bad.project.scenes[1].items.length, 7);
  assert.deepEqual(bad.project.parts, { gear: '#aabbcc' });
  assert.doesNotThrow(() => render(bad.project, 3000));
  assert.equal(schema.normalizeProject(null).issues[0].level, 'error');
  assert.equal(schema.normalizeProject({ scenes: [] }).issues[0].level, 'error');
});

test('layout: both shapes keep the stage and panel apart and inside the frame', () => {
  for (const [w, h] of [[1920, 1080], [960, 540], [1080, 1920], [540, 960]]) {
    const f = layout.frameLayout(w, h);
    for (const r of [f.safe, f.head, f.stage, f.panel]) assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.w <= w + 1e-6 && r.y + r.h <= h + 1e-6, `${w}x${h} inside`);
    if (f.landscape) assert.ok(f.panel.x >= f.stage.x + f.stage.w - 1e-6, 'panel beside the stage');
    else assert.ok(f.panel.y >= f.stage.y + f.stage.h - 1e-6, 'panel under the stage');
    assert.ok(f.panel.y + f.panel.h <= f.h * 0.9 + 1e-6, 'room left for captions');
  }
});

test('primitives: seeded randomness repeats, colours mix and parse', () => {
  const a = prim.rng('x'), b = prim.rng('x');
  assert.deepEqual([a(), a(), a()], [b(), b(), b()]);
  assert.notEqual(prim.rng('x')(), prim.rng('y')());
  assert.equal(prim.hash01(5), prim.hash01(5)); assert.notEqual(prim.hash01(5), prim.hash01(6)); assert.ok(prim.hash01(-7) >= 0 && prim.hash01(-7) < 1);
  assert.equal(prim.mix('#000000', '#ffffff', 0.5), '#808080');
  assert.deepEqual(prim.parseHex('#f80'), [255, 136, 0]);
  assert.equal(prim.rgba('#ff0000', 0.5), 'rgba(255,0,0,0.500)');
  assert.ok(Math.abs(Math.abs(prim.wrapPi(3 * Math.PI)) - Math.PI) < 1e-9);
});

test('the explainer depends on nothing but React, Next and its own code, and has no built-in components', () => {
  const files = [];
  (function walk(dir) { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) walk(p); else if (/\.(ts|tsx)$/.test(e.name)) files.push(p); } })(EXPLAINER);
  assert.ok(files.length >= 15);
  const allowedExternal = /^(react|react-dom|lucide-react|next(\/[a-z/-]+)?)$/;
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    for (const m of text.matchAll(/(?:import|export)[^'"]*?from\s+['"]([^'"]+)['"]/g)) {
      const spec = m[1];
      if (spec.startsWith('.')) assert.ok(path.resolve(path.dirname(file), spec).startsWith(EXPLAINER), `${path.relative(SRC, file)} reaches outside the explainer: ${spec}`);
      else if (spec.startsWith('@/')) assert.ok(spec.startsWith('@/explainer/'), `${path.relative(SRC, file)} imports ${spec}`);
      else assert.ok(allowedExternal.test(spec), `${path.relative(SRC, file)} imports ${spec}`);
    }
  }
  assert.equal(fs.existsSync(path.join(EXPLAINER, 'mechanisms')), false, 'the hand-written engine is gone from the app: components are written by agents as data');
  // the app shell (src/app) only uses the explainer and framework code
  for (const file of ['layout.tsx', 'page.tsx']) {
    for (const m of fs.readFileSync(path.join(SRC, 'app', file), 'utf8').matchAll(/from\s+['"]([^'"]+)['"]/g)) assert.ok(m[1].startsWith('@/explainer/') || allowedExternal.test(m[1]) || m[1].startsWith('./'), `${file} imports ${m[1]}`);
  }
});
