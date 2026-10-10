#!/usr/bin/env node
// Explainer MCP server: lets agents draw with the app.
// An agent reads the drawing guide, authors a drawing or project as JSON,
// validates it, and saves it where the app's dashboard can import it.
//
// Run: node mcp/server.mjs
// Projects dir: $EXPLAINER_PROJECTS_DIR (default <repo>/projects).

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(ROOT, 'cli', 'validate-drawing.cjs');
const GUIDE = join(ROOT, 'docs', 'DRAWING.md');
const PROJECTS_DIR = process.env.EXPLAINER_PROJECTS_DIR || join(ROOT, 'projects');
mkdirSync(PROJECTS_DIR, { recursive: true });

// The repo's own TypeScript, reused to read the live examples.
const require = createRequire(import.meta.url);
const ts = require(join(ROOT, 'node_modules', 'typescript'));
const cache = new Map();
const resolveTs = base => (existsSync(base + '.ts') ? base + '.ts' : join(base, 'index.ts'));
function loadTs(file) {
  const abs = resolve(file);
  if (cache.has(abs)) return cache.get(abs).exports;
  const text = readFileSync(abs, 'utf8');
  const output = ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const m = { exports: {} };
  cache.set(abs, m);
  const path = require('node:path');
  new Function('require', 'module', 'exports', output)(
    id => (id.startsWith('.') ? loadTs(resolveTs(resolve(path.dirname(abs), id))) : require(id)),
    m, m.exports,
  );
  return m.exports;
}
const sample = loadTs(join(ROOT, 'src', 'explainer', 'sample.ts'));
const EXAMPLES = [
  { id: 'engine', label: 'How a car engine works', blurb: 'The four-stroke engine, written as data', project: () => sample.SAMPLE_ENGINE_DRAWING, script: () => sample.ENGINE_SCRIPT },
  { id: 'water', label: 'How the water cycle works', blurb: 'A second proof, same drawing format', project: () => sample.SAMPLE_WATER_CYCLE, script: () => '' },
];

/** Runs the repo's own validator on a JSON value; returns the parsed report. */
function validateJson(value, strict = false) {
  return new Promise(resolveResult => {
    const dir = mkdtempSync(join(tmpdir(), 'explainer-mcp-'));
    const file = join(dir, 'drawing.json');
    writeFileSync(file, JSON.stringify(value));
    const args = [CLI, file, '--json'];
    if (strict) args.push('--strict');
    execFile(process.execPath, args, { timeout: 90000, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      let report = null;
      try { report = JSON.parse(stdout); } catch { /* fall through */ }
      if (!report) {
        resolveResult({ ok: false, text: `The validator failed to run: ${String((err && err.message) || stderr || 'unknown error').slice(0, 300)}` });
        return;
      }
      const errors = report.flatMap(r => r.issues.filter(i => i.level === 'error').map(i => `${r.drawing}: ${i.message}`));
      const warnings = report.flatMap(r => r.issues.filter(i => i.level !== 'error').map(i => `${r.drawing}: ${i.message}`));
      const failed = errors.length > 0 || (strict && warnings.length > 0);
      const lines = [
        failed ? 'NOT VALID' : 'VALID',
        ...errors.map(e => `ERROR: ${e}`),
        ...warnings.map(w => `${strict ? 'ERROR' : 'warning'}: ${w}`),
        ...report.map(r => `worst frame cost ${r.budget.maxUsed} (cap ${r.budget.cap})`),
      ];
      resolveResult({ ok: !failed, text: lines.join('\n') });
    });
  });
}

const safeName = name => /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,60}$/.test(name);
const projectFile = name => join(PROJECTS_DIR, `${name}.json`);

const server = new McpServer({ name: 'explainer', version: '1.0.0' });

server.registerResource(
  'drawing-guide',
  'explainer://guide/drawing',
  { title: 'The drawing block: how an agent draws its own component', mimeType: 'text/markdown' },
  async uri => ({ contents: [{ uri: uri.href, text: readFileSync(GUIDE, 'utf8') }] }),
);

server.registerTool('validate_drawing', {
  description: 'Checks an agent-authored drawing (or a whole project: every drawing scene is checked). Returns VALID or a list of fixable problems: where each one is and what is wrong. Run this on every drawing before saving it.',
  inputSchema: {
    drawing: z.record(z.string(), z.any()).describe('The drawing object (block "drawing"), or a project object with a scenes array.'),
    strict: z.boolean().optional().describe('Treat warnings as failures.'),
  },
}, async ({ drawing, strict }) => {
  const r = await validateJson(drawing, strict ?? false);
  return { content: [{ type: 'text', text: r.text }], isError: !r.ok };
});

server.registerTool('list_examples', {
  description: 'Lists the example videos that ship with the app, to start from or learn the format.',
  inputSchema: {},
}, async () => ({
  content: [{ type: 'text', text: EXAMPLES.map(e => `${e.id}: ${e.label} — ${e.blurb}`).join('\n') }],
}));

server.registerTool('get_example', {
  description: 'Returns an example as a full project object (scenes, theme, aspect) plus its narration script.',
  inputSchema: { id: z.enum(['engine', 'water']) },
}, async ({ id }) => {
  const e = EXAMPLES.find(x => x.id === id);
  return { content: [{ type: 'text', text: JSON.stringify({ project: e.project(), script: e.script() }, null, 2) }] };
});

server.registerTool('list_projects', {
  description: 'Lists the project files agents have saved.',
  inputSchema: {},
}, async () => {
  const names = readdirSync(PROJECTS_DIR).filter(f => f.endsWith('.json')).map(f => f.slice(0, -5));
  const rows = names.map(n => {
    let scenes = '?';
    try {
      const p = JSON.parse(readFileSync(projectFile(n), 'utf8'));
      scenes = Array.isArray(p.scenes) ? String(p.scenes.length) : '?';
    } catch { /* unreadable */ }
    const mt = statSync(projectFile(n)).mtime.toISOString().slice(0, 16).replace('T', ' ');
    return `${n}: ${scenes} scenes, saved ${mt}`;
  });
  return { content: [{ type: 'text', text: rows.length ? rows.join('\n') : 'No saved projects yet.' }] };
});

server.registerTool('get_project', {
  description: 'Reads back a saved project file.',
  inputSchema: { name: z.string().describe('The project name (letters, digits, _ and -).') },
}, async ({ name }) => {
  if (!safeName(name)) return { content: [{ type: 'text', text: 'That name is not allowed.' }], isError: true };
  try {
    return { content: [{ type: 'text', text: readFileSync(projectFile(name), 'utf8') }] };
  } catch {
    return { content: [{ type: 'text', text: `No project named "${name}".` }], isError: true };
  }
});

server.registerTool('save_project', {
  description: 'Validates a project (every drawing scene is checked) and saves it as a file the app can import. The project is an object with aspect ("16:9" or "9:16"), theme ("blueprint" or "flat") and a scenes array; scenes are title, bullets or drawing blocks. Include a "script" string alongside when the video will be narrated.',
  inputSchema: {
    name: z.string().describe('File name (letters, digits, _ and -).'),
    project: z.record(z.string(), z.any()).describe('The project object.'),
    script: z.string().optional().describe('The narration script, plain text with blank lines between paragraphs.'),
  },
}, async ({ name, project, script }) => {
  if (!safeName(name)) return { content: [{ type: 'text', text: 'That name is not allowed.' }], isError: true };
  if (!project || !Array.isArray(project.scenes) || !project.scenes.length) {
    return { content: [{ type: 'text', text: 'A project needs a scenes array with at least one scene.' }], isError: true };
  }
  const v = await validateJson(project);
  if (!v.ok) return { content: [{ type: 'text', text: `Not saved — fix these first:\n${v.text}` }], isError: true };
  writeFileSync(projectFile(name), JSON.stringify({ ...project, script: script ?? '' }, null, 2));
  return { content: [{ type: 'text', text: `Saved to ${projectFile(name)} and valid. Import it from the app's dashboard (Import JSON).` }] };
});

const transport = new StdioServerTransport();
await server.connect(transport);
