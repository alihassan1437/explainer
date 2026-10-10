#!/usr/bin/env node
// validate-drawing: the headless check for agent-authored drawings.
// An agent writes a drawing as JSON, runs this, and fixes whatever it reports.
// Usage: node cli/validate-drawing.cjs <drawing.json|project.json> [--samples 5] [--strict] [--json]
//
// Exit codes: 0 = valid, 1 = errors (or warnings with --strict), 2 = usage or file problems.

const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

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
const dcompile = ex('drawing/compile.ts');
const drender = ex('drawing/render.ts');
const theme = ex('theme.ts');
const timing = ex('timing.ts');

const USAGE = 'usage: node cli/validate-drawing.cjs <drawing.json|project.json> [--samples 5] [--strict] [--json]';

function fail(msg) { console.error(`validate-drawing: ${msg}`); process.exit(2); }

function parseArgs(argv) {
  const opts = { file: null, samples: 5, strict: false, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--samples') { opts.samples = Math.max(1, parseInt(argv[++i], 10) || 5); }
    else if (a === '--strict') opts.strict = true;
    else if (a === '--json') opts.json = true;
    else if (a === '--help' || a === '-h') { console.log(USAGE); process.exit(0); }
    else if (a.startsWith('-')) fail(`unknown option ${a}\n${USAGE}`);
    else if (opts.file) fail(`only one file, got ${opts.file} and ${a}\n${USAGE}`);
    else opts.file = a;
  }
  if (!opts.file) fail(USAGE);
  return opts;
}

/** A file holds one drawing, or a project whose drawing scenes are all checked. */
function drawingsIn(raw, file) {
  if (raw && Array.isArray(raw.scenes)) {
    const out = [];
    raw.scenes.forEach((s, i) => {
      if (s && (s.block === 'drawing' || Array.isArray(s.shapes))) out.push({ name: `scene ${i + 1}${s.title ? ` (${s.title})` : ''}`, drawing: s });
    });
    if (!out.length) fail(`${file}: the project has no drawing scenes.`);
    return out;
  }
  if (raw && (raw.block === 'drawing' || Array.isArray(raw.shapes))) return [{ name: path.basename(file), drawing: raw }];
  fail(`${file}: expected a drawing (block "drawing", or a shapes array) or a project with scenes.`);
  return [];
}

function validateDrawing(name, drawing, samples) {
  const { compiled, issues } = dcompile.compileDrawing(drawing, 1);
  const result = { drawing: name, issues: issues.map(i => ({ level: i.level, message: i.message })), budget: null };
  const len = timing.sceneLengthMs({ block: 'drawing', lengthMs: drawing.lengthMs });
  const times = [];
  for (let k = 0; k < samples; k++) times.push(Math.min(len - 1, Math.round((len * k) / Math.max(1, samples - 1))));
  let maxUsed = 0;
  const overAt = [];
  for (const themeId of ['blueprint', 'flat']) {
    const project = { aspect: '16:9', theme: themeId, scenes: [] };
    const palette = theme.paletteOf(project);
    for (const ms of times) {
      let r;
      try {
        r = drender.evalDrawing(compiled, { t: ms, len, startMs: 0, project, theme: theme.THEMES[themeId], palette, portrait: false });
      } catch (e) {
        result.issues.push({ level: 'error', message: `the renderer threw at t=${(ms / 1000).toFixed(1)}s (${themeId}): ${e instanceof Error ? e.message : String(e)}` });
        continue;
      }
      maxUsed = Math.max(maxUsed, r.used);
      if (r.overBudget) overAt.push(`${(ms / 1000).toFixed(1)}s ${themeId}`);
    }
  }
  result.budget = { maxUsed, cap: dcompile.DLIMITS.frameCost, overAt };
  for (const at of overAt) {
    result.issues.push({ level: 'warning', message: `frame over budget at t=${at}: simplify the drawing (fewer shapes, cheaper expressions).` });
  }
  return result;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(opts.file, 'utf8'));
  } catch (e) {
    fail(`cannot read ${opts.file}: ${e instanceof Error ? e.message : String(e)}`);
  }
  const results = drawingsIn(raw, opts.file).map(({ name, drawing }) => validateDrawing(name, drawing, opts.samples));

  if (opts.json) {
    console.log(JSON.stringify(results, null, 2));
  } else {
    for (const r of results) {
      console.log(`\n${r.drawing}:`);
      if (!r.issues.length) console.log('  valid — no errors or warnings.');
      for (const i of r.issues) console.log(`  ${i.level.toUpperCase()}: ${i.message}`);
      console.log(`  worst frame cost ${r.budget.maxUsed} (cap ${r.budget.cap}).`);
    }
    const errors = results.reduce((n, r) => n + r.issues.filter(i => i.level === 'error').length, 0);
    const warnings = results.reduce((n, r) => n + r.issues.filter(i => i.level === 'warning').length, 0);
    console.log(`\n${errors} error(s), ${warnings} warning(s) in ${results.length} drawing(s).`);
  }

  const errors = results.reduce((n, r) => n + r.issues.filter(i => i.level === 'error').length, 0);
  const warnings = results.reduce((n, r) => n + r.issues.filter(i => i.level === 'warning').length, 0);
  process.exit(errors || (opts.strict && warnings) ? 1 : 0);
}

main();
