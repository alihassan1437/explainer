// Tests for the Explainer's agent-written drawings: the expression language, the drawing checks, and the proof that the engine written as data
// computes exactly what the same engine written as ordinary code does (tests/fixtures/engine-reference.ts, which is not part of the app).
const test = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');
const fs = require('node:fs');
const path = require('node:path');

const EXPLAINER = path.join(__dirname, '../src/explainer');
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
const expr = ex('expr/index.ts'), dcompile = ex('drawing/compile.ts'), drender = ex('drawing/render.ts'), engineData = ex('examples/engine.ts'), waterData = ex('examples/water-cycle.ts');
const engine = load(path.join(__dirname, 'fixtures/engine-reference.ts')), theme = ex('theme.ts'), frame = ex('draw/frame.ts'), prim = ex('draw/primitives.ts'), schema = ex('schema.ts'), timing = ex('timing.ts');

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

const num = (src, scope = {}) => { const r = expr.compile(src, new Set(Object.keys(scope))); if ('error' in r) throw new Error(`${src}: ${r.error}`); return expr.evaluate(r.expr, scope); };
const bad = (src, scope = {}) => { const r = expr.compile(src, new Set(Object.keys(scope))); assert.ok('error' in r, `should be rejected: ${src.slice(0, 60)}`); return r.error; };
const compileOf = scene => dcompile.compileDrawing(scene, 1);
const errorsOf = r => r.issues.filter(i => i.level === 'error').map(i => i.message);

test('expressions: arithmetic, precedence and the functions behave like maths', () => {
  assert.equal(num('2+3*4'), 14); assert.equal(num('(2+3)*4'), 20); assert.equal(num('-2^2'), -4); assert.equal(num('2^3^2'), 512);
  assert.equal(num('10-4-3'), 3); assert.equal(num('7%3'), 1); assert.equal(num('-7%3'), 2, 'the remainder is never negative'); assert.equal(num('8/2/2'), 2);
  assert.equal(num('1<2'), 1); assert.equal(num('2<=1'), 0); assert.equal(num('2==2&&3!=4'), 1); assert.equal(num('0||0'), 0); assert.equal(num('!0'), 1); assert.equal(num('!5'), 0);
  assert.equal(num('if(1,5,6)'), 5); assert.equal(num('if(0,5,6)'), 6); assert.equal(num('min(3,1,2)'), 1); assert.equal(num('max(3,1,2)'), 3);
  assert.equal(num('clamp(5,0,1)'), 1); assert.equal(num('mix(10,20,0.25)'), 12.5); assert.equal(num('smooth(0,10,5)'), 0.5); assert.equal(num('step(2,3)'), 1);
  assert.equal(num('wrap(-1,360)'), 359); assert.equal(num('floor(2.7)+ceil(2.2)+round(2.5)'), 2 + 3 + 3);
  assert.ok(Math.abs(num('sin(pi/2)') - 1) < 1e-12); assert.ok(Math.abs(num('cos(rad(60))') - 0.5) < 1e-12); assert.ok(Math.abs(num('deg(pi)') - 180) < 1e-12);
  assert.ok(Math.abs(Math.abs(num('wrappi(3*pi)')) - Math.PI) < 1e-9);
  assert.equal(num('x*2+y', { x: 3, y: 1 }), 7);
  assert.equal(num('SIN(0)+Min(1,2)'), 1, 'function names are not case sensitive');
  assert.equal(num('rand(5)'), num('rand(5)'), 'rand is the same every time'); assert.notEqual(num('rand(5)'), num('rand(6)'));
  assert.ok(num('rand(5)') >= 0 && num('rand(5)') < 1);
  assert.equal(num('ease(0)'), 0); assert.equal(num('ease(1)'), 1); assert.equal(num('pulse(5,0,10)'), 1);
});

test('expressions: anything that is not plain maths is rejected with a sentence that says why', () => {
  const cases = [
    'constructor', '__proto__', 'this', 'window', 'process.exit()', 'eval("1")', 'Math.sin(1)', 'a.b', "'text'", '"text"', '1;2', 'x=1', '[1,2]', '{a:1}', '`x`', 'alert(1)', 'require("fs")',
    'sin(', 'sin(1', '1+', '*2', '()', 'sin()', 'sin(1,2)', 'clamp(1,2)', 'foo(1)', '1 2', '1..2', '#ff0000', 'a ? b : c', 'x => x', 'function(){}', 'import("x")', '€5',
  ];
  for (const c of cases) assert.equal(typeof bad(c), 'string', c);
  assert.match(bad('speed*2', { Speed: 1 }), /did you mean "Speed"/);
  assert.match(bad('foo(1)'), /not a function here/);
  assert.match(bad('sin(1,2)'), /takes 1/);
  assert.match(bad(''), /empty/);
  for (const name of ['constructor', 'toString', 'hasOwnProperty', '__proto__', 'valueOf']) assert.match(bad(name), /not defined/, name);
  assert.equal(num('x', { x: 5 }), 5);
});

test('expressions: size and depth are limited, and bad numbers cannot spoil a frame', () => {
  assert.match(bad('1+'.repeat(300) + '1'), /longer than 500|too long/);
  assert.match(bad('('.repeat(40) + '1' + ')'.repeat(40)), /nested too deeply|too long/);
  assert.match(bad(Array.from({ length: 170 }, () => '1').join('+')), /too long/);
  assert.match(bad('a'.repeat(60)), /too long/);
  assert.equal(expr.safe(num('1/0')), 0); assert.equal(expr.safe(num('sqrt(-1)')), 0); assert.equal(expr.safe(num('pow(10,1000)')), 0); assert.equal(expr.safe(num('ln(0)')), 0);
  assert.equal(num('7%0'), 0);
  const ok = expr.compile('sin(t)*2+1', new Set(['t'])).expr;
  assert.ok(ok.cost > 0 && ok.vars.includes('t'));
});

test('drawing: the engine written as data compiles with no problems and costs little', () => {
  const r = compileOf(engineData.ENGINE_DRAWING);
  assert.deepEqual(r.issues, []);
  assert.ok(r.compiled.shapes.length >= 38, `shapes ${r.compiled.shapes.length}`);
  assert.ok(r.compiled.cost < dcompile.DLIMITS.frameCost / 2, `cost ${r.compiled.cost}`);
  assert.equal(Object.keys(r.compiled.parts).length, 13);
  assert.deepEqual(compileOf(waterData.WATER_CYCLE_DRAWING).issues, []);
});

test('drawing: mistakes are reported where they are, the broken shape is left out and the rest still draws', () => {
  const base = { block: 'drawing', stage: { w: 8, h: 6 }, parts: { a: { color: 'accent' } } };
  const shapes = s => compileOf({ ...base, shapes: s });
  const r = shapes([{ type: 'circle', x: 0, y: 0, r: 1, part: 'a' }, { type: 'circle', x: 'oops', y: 0, r: 1 }, { type: 'circle', x: 0, y: 0 }, { type: 'blob' }, { type: 'circle', x: 0, y: 0, r: 1, part: 'zzz' }]);
  assert.equal(r.compiled.shapes.length, 1, 'only the good one is kept');
  const text = errorsOf(r).join('\n');
  assert.match(text, /shape 2.*"oops".*not defined/); assert.match(text, /shape 3 \(circle\) needs "r"/); assert.match(text, /shape 4 must have a type/); assert.match(text, /shape 5 uses the part "zzz"/);
  assert.match(errorsOf(shapes([]))[0], /There are no shapes/);
  assert.match(errorsOf(shapes([{ type: 'circle', x: 0, y: 0, r: 1, repeat: 100000 }])).join(), /repeat must be a whole number from 1 to 200/);
  assert.match(errorsOf(shapes([{ type: 'curve', n: 9999, x: 'j', y: 'j' }])).join(), /needs "n"/);
  assert.match(errorsOf(shapes([{ type: 'circle', x: 'j', y: 0, r: 1 }])).join(), /"j".*not defined/, 'j and u exist only inside a curve');
  assert.match(errorsOf(shapes([{ type: 'circle', x: 'i', y: 0, r: 1 }])).join(), /"i".*not defined/, 'i exists only inside a repeat');
  assert.match(errorsOf(shapes([{ type: 'circle', x: 0, y: 0, r: 1, fill: 'purplish' }])).join(), /not a colour/);
  // a drawing that would need too much work every frame is refused up front
  const heavy = Array.from({ length: 80 }, () => ({ type: 'curve', n: 200, close: true, repeat: 200, x: 'sin(j)*cos(j)+sin(j)*cos(j)+sin(j)*cos(j)+sin(j)*cos(j)+sin(j)*cos(j)', y: 'j' }));
  assert.match(errorsOf(shapes(heavy)).join(), /expression steps per frame/);
  // names: nothing may use a JavaScript object's own names, built-ins or an earlier name
  const named = v => compileOf({ ...base, vars: v, shapes: [{ type: 'circle', x: 0, y: 0, r: 1 }] });
  for (const name of ['__proto__', 'constructor', 'toString', 'sin', 'pi', 't', 'i', 'u', 'flat', 'two words', '9x']) assert.ok(errorsOf(named({ [name]: 1 })).length > 0, name);
  assert.match(errorsOf(named({ b: 'a+1', a: '1' })).join(), /"a".*not defined/, 'a value may only use values defined before it');
  assert.match(errorsOf(named({ a: 'a+1' })).join(), /"a".*not defined/, 'and not itself');
  const weird = compileOf({ ...base, parts: { constructor: { color: 'ink' }, ok: { color: 'ink' } }, shapes: [{ type: 'circle', x: 0, y: 0, r: 1, part: 'ok' }] });
  assert.deepEqual(Object.keys(weird.compiled.parts), ['ok'], 'a part may not be called constructor');
  assert.equal(Object.getPrototypeOf(compileOf({ ...base, shapes: [{ type: 'circle', x: 0, y: 0, r: 1 }] }).compiled.parts), Object.prototype, 'nothing can change the prototype');
  assert.match(compileOf({ block: 'drawing', shapes: [{ type: 'circle', x: 0, y: 0, r: 1 }] }).issues[0].message, /stage needs w and h/);
});

/** The numbers and colours the hand-written engine would draw, for comparing against the drawing. One four-stroke cycle per 34 s scene, like the drawing. */
function referenceAt(themeId, ms) {
  const project = { aspect: '16:9', theme: themeId, scenes: [] };
  return { project, state: engine.engineState((ms / 1000) * (720 / 34)), colors: engine.partColors(themeId) };
}

test('the engine written as data draws exactly what the hand-written engine does, in both themes', () => {
  const compiled = compileOf(engineData.ENGINE_DRAWING).compiled;
  const times = [0, 700, 1500, 2600, 3900, 4100, 4600, 6500, 8000, 9700, 11000, 13000, 16200, 17000, 19800, 22000, 24500, 27000, 28800, 31000, 33900];
  let sparkSeen = 0;
  for (const themeId of ['blueprint', 'flat']) {
    for (const ms of times) {
      const { project, state, colors } = referenceAt(themeId, ms);
      const r = drender.evalDrawing(compiled, { t: ms, len: 34000, startMs: 0, project, theme: theme.THEMES[themeId], palette: theme.paletteOf(project), portrait: false });
      const at = `${themeId} ${ms} ms`;
      const near = (a, b, what) => assert.ok(Math.abs(a - b) < 1e-9, `${what} at ${at}: ${a} against ${b}`);
      near(r.scope.pinY, state.pistonPinY, 'piston pin'); near(r.scope.liftIn, state.liftIn, 'intake lift'); near(r.scope.liftEx, state.liftEx, 'exhaust lift');
      near(r.scope.spark, state.spark, 'spark'); near(r.scope.flame, state.flame, 'flame'); near(r.scope.th, state.theta, 'crank angle'); near(r.scope.stroke, state.stroke, 'stroke');
      near(r.scope.cpx, state.crankPin[0], 'crank pin x'); near(r.scope.cpy, state.crankPin[1], 'crank pin y'); near(r.scope.camIn, state.camIn, 'intake cam'); near(r.scope.cyc, state.cycleIndex, 'cycle');
      for (const part of Object.keys(colors)) assert.equal(r.partColors[part].toLowerCase(), colors[part].toLowerCase(), `${part} colour at ${at}`);
      const byId = id => r.cmds.filter(c => c.id === id);
      const piston = byId('piston')[0].p;
      near(piston[1], state.pistonPinY - engine.G.pinToBottom, 'piston bottom'); near(piston[3], state.pistonTopY, 'piston top'); near(piston[0], -0.9, 'piston left');
      const dx = -state.crankPin[0], dy = state.pistonPinY - state.crankPin[1], len = Math.hypot(dx, dy), nx = (-dy / len) * 0.07, ny = (dx / len) * 0.07, [pinX, pinY] = state.crankPin;
      const rod = byId('rod')[0].pts;
      [[pinX + nx * 1.7, pinY + ny * 1.7], [nx, state.pistonPinY + ny], [-nx, state.pistonPinY - ny], [pinX - nx * 1.7, pinY - ny * 1.7]].forEach((w, k) => { near(rod[k][0], w[0], `rod ${k}x`); near(rod[k][1], w[1], `rod ${k}y`); });
      near(byId('inDisc')[0].pts[0][1], engine.HEAD_Y - state.liftIn, 'intake valve disc');
      const cam = byId('inCam')[0].pts; assert.equal(cam.length, 73);
      const a = (10 / 72) * Math.PI * 2, rr = engine.G.camR + engine.G.lobe * Math.exp(-Math.pow(prim.wrapPi(a - state.camIn) / engine.G.lobeWidth, 2));
      near(cam[10][0], -0.5 + rr * Math.sin(a), 'cam x'); near(cam[10][1], engine.CAM_Y - rr * Math.cos(a), 'cam y');
      const sparkCmd = byId('spark');
      assert.equal(sparkCmd.length > 0, state.spark > 0.05, `the spark appears only while it fires (${at})`);
      if (sparkCmd.length) {
        sparkSeen++;
        const sb = (state.cycleIndex * 1000 + Math.floor(state.cycleDeg / 2)) * 16;
        near(sparkCmd[0].pts[2][0], 0.13 - 2 * 0.06 + (prim.hash01(sb + 4) - 0.5) * 0.1, 'spark zig'); near(sparkCmd[0].alpha, state.spark, 'spark strength');
      }
      const gas = engine.gasFor(state.cycleIndex), cmds = byId('gas');
      assert.equal(cmds.length, 38);
      gas.forEach((g, i) => {
        const ref = engine.gasParticle(g, state, ms / 1000), c = cmds[i];
        near(c.alpha, ref.alpha * 0.95, `gas ${i} alpha`);
        if (ref.alpha < 0.02) return;
        near(c.p[0], ref.x, `gas ${i} x`); near(c.p[1], ref.y, `gas ${i} y`);
        const inChamber = state.cycleDeg >= 360 && state.cycleDeg < g.exit;
        const colour = inChamber ? prim.mix(colors.exhaust, colors.flame, ref.burn * 0.95) : state.cycleDeg >= g.exit ? colors.exhaust : colors.mixture;
        assert.equal(c.fill.toLowerCase(), colour.toLowerCase(), `gas ${i} colour at ${at}`);
      });
      assert.deepEqual(r.panel.items.map(i => i.active), [0, 1, 2, 3].map(k => k === state.stroke), 'the lit stroke'); near(r.panel.counter, state.cycleIndex + 1, 'cycle counter');
      near(r.panel.items[state.stroke].progress, state.strokeProgress, 'stroke progress');
      const rodLabel = r.labels.find(l => l.part === 'connectingRod'); near(rodLabel.tx, pinX / 2, 'rod label x'); near(rodLabel.ty, (pinY + state.pistonPinY) / 2, 'rod label y');
      assert.deepEqual(r.labels.map(l => l.part), ['intakeValve', 'camshaft', 'connectingRod', 'crankshaft', 'exhaustValve', 'sparkPlug', 'cylinder', 'piston']);
      assert.equal(r.overBudget, false);
    }
  }
  assert.ok(sparkSeen >= 2, 'the sample times include the moment the spark fires');
});

test('a drawing is drawn the same every time, never from chance or the clock, in both shapes', () => {
  const projects = [{ aspect: '16:9', theme: 'blueprint', scenes: [engineData.ENGINE_DRAWING] }, { aspect: '9:16', theme: 'flat', scenes: [waterData.WATER_CYCLE_DRAWING] }];
  const realRandom = Math.random, realNow = Date.now;
  Math.random = () => { throw new Error('Math.random was used'); }; Date.now = () => { throw new Error('Date.now was used'); };
  try {
    for (const p of projects) for (const t of [0, 800, 4100, 9999, 17000, 29000]) assert.equal(render(p, t, 800, p.aspect === '16:9' ? 450 : 1000), render(p, t, 800, p.aspect === '16:9' ? 450 : 1000), `${p.scenes[0].title} at ${t}`);
  } finally { Math.random = realRandom; Date.now = realNow; }
  assert.notEqual(render(projects[0], 5000), render(projects[0], 5300));
  assert.notEqual(render(projects[1], 6000, 800, 1000), render({ ...projects[1], theme: 'blueprint' }, 6000, 800, 1000));
});

test('a different topic needs no new app code: the water cycle runs on the same blocks and reacts to the colours the user picks', () => {
  const compiled = compileOf(waterData.WATER_CYCLE_DRAWING).compiled;
  const ctx = (t, over = {}) => ({ t, len: 32000, startMs: 0, project: {}, theme: theme.THEMES.blueprint, palette: theme.paletteOf({ theme: 'blueprint' }), portrait: false, ...over });
  const stageOf = t => drender.evalDrawing(compiled, ctx(t)).panel.items.findIndex(i => i.active);
  assert.deepEqual([1000, 5000, 9000, 13000, 17000, 21000].map(stageOf), [0, 1, 2, 3, 0, 1], 'the four stages follow each other and repeat');
  const early = drender.evalDrawing(compiled, ctx(1000)), raining = drender.evalDrawing(compiled, ctx(9500));
  assert.equal(early.cmds.filter(c => c.id === 'drop').length, 0, 'no rain yet'); assert.ok(raining.cmds.filter(c => c.id === 'drop').length >= 10, 'rain falls in the third stage');
  assert.ok(early.cmds.filter(c => c.id === 'vapor' && c.alpha > 0.05).length > 4, 'vapour rises in the first stage');
  const picked = drender.evalDrawing(compiled, ctx(9500, { project: { parts: { rain: '#123456' } } }));
  const rain = picked.cmds.filter(c => c.part === 'rain');
  assert.ok(rain.length > 0 && rain.every(c => c.stroke.toLowerCase() === '#123456'), 'the colour reaches every shape of that part');
  const own = dcompile.compileDrawing({ ...waterData.WATER_CYCLE_DRAWING, colors: { rain: '#654321', nope: '#ffffff' } }, 1).compiled;
  assert.equal(drender.evalDrawing(own, ctx(9500, { project: { parts: { rain: '#123456' } } })).partColors.rain, '#654321', "a scene's own colour beats the project's");
  assert.ok(!('nope' in own.scene.colors), 'a colour for a part that does not exist is dropped');
});

test('events, cues and spoken words give a drawing values it can use', () => {
  const scene = {
    block: 'drawing', stage: { w: 4, h: 4 }, parts: { gear: { color: 'accent' } },
    events: { pop: { at: { word: 'gear' }, ms: 2000 } }, cues: [{ at: 500, do: 'highlight', part: 'gear', ms: 1500 }],
    vars: { size: '0.5+pop', lit: 'hl_gear', age: 'pop_age' },
    shapes: [{ type: 'circle', id: 'g', part: 'gear', x: 0, y: 0, r: 'size' }],
  };
  const c = dcompile.compileDrawing(scene, 1);
  assert.deepEqual(c.issues, []);
  const run = (t, words) => drender.evalDrawing(c.compiled, { t, len: 10000, startMs: 4000, words, project: {}, theme: theme.THEMES.blueprint, palette: theme.paletteOf({ theme: 'blueprint' }), portrait: false });
  const words = [{ text: 'The', startMs: 4000, endMs: 4200 }, { text: 'Gear.', startMs: 6000, endMs: 6400 }];   // "gear" is spoken 2000 ms into the scene
  assert.equal(run(1000, words).scope.pop, 0, 'before the word'); assert.ok(run(3000, words).scope.pop > 0.95, 'while it is spoken');
  assert.ok(Math.abs(run(3000, words).scope.pop_age - 1) < 1e-9); assert.equal(run(1000, undefined).scope.pop, 0, 'no narration, no word cue');
  assert.ok(run(1000).scope.hl_gear > 0.95 && run(3000).scope.hl_gear === 0 && run(100).scope.hl_gear === 0);
  assert.ok(run(1000).cmds[0].emph > 0.95, 'a highlighted part is emphasised automatically');
  assert.ok(run(3000, words).cmds[0].p[2] > 1.4 && run(0, words).cmds[0].p[2] === 0.5);
});

test('the drawing reference stays true: its example compiles, and it lists exactly the functions and limits that exist', () => {
  const doc = fs.readFileSync(path.join(__dirname, '../docs/DRAWING.md'), 'utf8');
  const example = JSON.parse(/```json\n([\s\S]*?)```/.exec(doc)[1]);
  const r = compileOf(example);
  assert.deepEqual(r.issues, []);
  assert.equal(r.compiled.shapes.length, 2);
  const listed = /Functions: ([^\n]+)\./.exec(doc)[1].replace(/`/g, '').split(/\s+/).filter(Boolean).sort();
  assert.deepEqual(listed, [...expr.FUNCTION_NAMES].sort(), 'the documented functions are the real ones');
  assert.ok(doc.includes('500 characters') && doc.includes('160 parts') && doc.includes(`${dcompile.DLIMITS.frameCost.toLocaleString('en-US')} expression steps`), 'the documented limits are the real ones');
  assert.ok(doc.includes(`(1 to ${dcompile.DLIMITS.repeat})`) && doc.includes(`At most ${dcompile.DLIMITS.shapes} shapes`) && doc.includes(`up to six explanations`));
  for (const name of ['t', 'ms', 'p', 'len', 'portrait', 'flat', 'pi', 'tau', 'i', 'n', 'j', 'u']) assert.ok(doc.includes('`' + name + '`'), `documents ${name}`);
  for (const file of ['engine.ts', 'water-cycle.ts']) assert.ok(fs.existsSync(path.join(EXPLAINER, 'examples', file)) && doc.includes(file));
});

test('schema: drawings are checked with the rest of the project, and their length is limited like any scene', () => {
  const good = schema.normalizeProject({ aspect: '16:9', theme: 'blueprint', scenes: [{ block: 'title', text: 'Hello' }, engineData.ENGINE_DRAWING] });
  assert.deepEqual(good.issues, []); assert.equal(good.project.scenes[1].block, 'drawing'); assert.equal(good.project.scenes[1].lengthMs, 34000);
  const short = schema.normalizeProject({ scenes: [{ ...waterData.WATER_CYCLE_DRAWING, lengthMs: 5 }] });
  assert.equal(short.project.scenes[0].lengthMs, 800);
  const broken = schema.normalizeProject({ scenes: [{ block: 'drawing', stage: { w: 8, h: 6 }, shapes: [{ type: 'circle', x: 'nope', y: 0, r: 1 }] }, { block: 'title', text: 'Still here' }] });
  const text = broken.issues.map(i => i.message).join('\n');
  assert.match(text, /Scene 1: shape 1.*"nope"/); assert.match(text, /Scene 1: no shape could be used/);
  assert.deepEqual(broken.project.scenes.map(s => s.block), ['title']);
  assert.doesNotThrow(() => render(good.project, 12000));
  assert.equal(timing.layoutTimeline(good.project).totalMs, 3000 + 34000);
});
