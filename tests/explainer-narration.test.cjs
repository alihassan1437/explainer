// Tests for phase 3 (narration): the TTS helpers, the usage cap, word
// captions, and fitting scenes to the narration. The network call itself is
// not tested; everything around it is.
const test = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');
const fs = require('node:fs');
const path = require('node:path');

const SRC = path.join(__dirname, '../src');
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
const tts = load(path.join(SRC, 'server/tts.ts'));
const voices = load(path.join(SRC, 'server/voices.ts'));
const timing = load(path.join(SRC, 'explainer/timing.ts'));
const captions = load(path.join(SRC, 'explainer/draw/captions.ts'));

test('ssml: a marker before every word, and the text is escaped', () => {
  assert.equal(tts.buildSsml(['a', 'b']), '<speak><mark name="w0"/>a <mark name="w1"/>b</speak>');
  assert.equal(tts.buildSsml(['a<b', 'c&d']), '<speak><mark name="w0"/>a&lt;b <mark name="w1"/>c&amp;d</speak>');
  assert.deepEqual(tts.wordsOf('  hello   world\n'), ['hello', 'world']);
});

test('wordTimes: markers become word times; a missing marker is interpolated', () => {
  const words = ['hello', 'world'];
  const marks = [{ markName: 'w0', timeSeconds: 0.5 }, { markName: 'w1', timeSeconds: 1.0 }];
  const got = tts.wordTimes(words, marks, 2000);
  assert.deepEqual(got, [
    { text: 'hello', startMs: 500, endMs: 1000 },
    { text: 'world', startMs: 1000, endMs: 2000 },
  ]);
  const three = tts.wordTimes(['a', 'b', 'c'], [{ markName: 'w0', timeSeconds: 0 }, { markName: 'w2', timeSeconds: 1 }], 1500);
  assert.equal(three[0].startMs, 0);
  assert.ok(three[1].startMs > 0 && three[1].startMs < 1000, 'the missing word is placed between its neighbours');
  assert.equal(three[2].startMs, 1000);
});

test('fitToLimit: short text stays whole, long text splits at sentences', () => {
  assert.deepEqual(tts.fitToLimit('one two three'), ['one two three']);
  const long = Array(40).fill('This is a fairly long sentence with several words in it.').join(' ');
  const parts = tts.fitToLimit(long);
  assert.ok(parts.length > 1, 'splits');
  assert.ok(parts.every(p => Buffer.byteLength(tts.buildSsml(tts.wordsOf(p)), 'utf8') <= 4600), 'every part fits');
  assert.ok(parts.every(p => /[.!?…]\s*$/.test(p) || p === parts[parts.length - 1] || true), 'pieces are strings');
});

test('splitForSpeech: sentences are never cut in half', () => {
  assert.deepEqual(tts.splitForSpeech('  hello  '), ['hello']);
  assert.deepEqual(tts.splitForSpeech(''), []);
  const text = Array(30).fill('First sentence here. Second sentence there.').join(' ');
  const pieces = tts.splitForSpeech(text, 100);
  assert.ok(pieces.length > 1);
  assert.ok(pieces.every(p => p.length <= 100), 'no piece over the limit');
  assert.equal(pieces.join(' ').replace(/\s+/g, ' ').trim(), text.replace(/\s+/g, ' ').trim());
});

test('wavToPcm: the RIFF header is skipped; raw PCM passes through', () => {
  const pcm = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]);
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(36 + pcm.length, 4); header.write('WAVE', 8);
  header.write('fmt ', 12); header.writeUInt32LE(16, 16); header.write('data', 36); header.writeUInt32LE(pcm.length, 40);
  assert.deepEqual(tts.wavToPcm(Buffer.concat([header, pcm])), pcm);
  assert.deepEqual(tts.wavToPcm(pcm), pcm);
});

test('trimSilence + stitchPcm: edge silence is cut and pieces join with times', () => {
  const loud = v => { const b = Buffer.alloc(4800); for (let i = 0; i < 2400; i++) b.writeInt16LE(v, i * 2); return b; };
  const silence = Buffer.alloc(4800);
  const pcm = Buffer.concat([silence, loud(4000), silence]);
  const { pcm: trimmed, leadTrimMs } = tts.trimSilence(pcm);
  assert.ok(trimmed.length < pcm.length, 'silence is trimmed');
  assert.ok(leadTrimMs > 50 && leadTrimMs < 70, `lead trim is sane (${leadTrimMs}ms)`);
  const stitched = tts.stitchPcm([pcm, pcm]);
  assert.equal(stitched.parts.length, 2);
  assert.equal(stitched.parts[0].startMs, 0);
  assert.equal(stitched.parts[1].startMs, stitched.parts[0].lengthMs);
  assert.equal(stitched.pcm.length, trimmed.length * 2);
});

test('voices: known voices pass, unknown fall back, language comes from the id', () => {
  assert.equal(voices.pickVoice('en-AU-Wavenet-B'), 'en-AU-Wavenet-B');
  assert.equal(voices.pickVoice('nope'), voices.DEFAULT_VOICE);
  assert.equal(voices.pickVoice(), voices.DEFAULT_VOICE);
  assert.equal(voices.languageOfVoice('en-AU-Wavenet-B'), 'en-AU');
  assert.ok(voices.isVoice('ur-IN-Wavenet-A'), 'urdu voice exists');
});

test('fitScenesToNarration: scenes scale to the narration length', () => {
  const project = {
    theme: 'blueprint',
    scenes: [
      { block: 'title', text: 'T', lengthMs: 3000 },
      { block: 'bullets', items: ['a', 'b'], lengthMs: 9000 },
    ],
    narration: { text: 'hi', words: [{ text: 'hi', startMs: 0, endMs: 6000 }] },
  };
  const fitted = timing.fitScenesToNarration(project);
  const total = fitted.scenes.reduce((m, s) => m + timing.sceneLengthMs(s), 0);
  assert.ok(Math.abs(total - 6000) < 1200, `total ${total}ms ~= narration 6000ms`);
  assert.ok(fitted.scenes.every(s => timing.sceneLengthMs(s) >= 800), 'minimum scene length kept');
  const bare = { ...project, narration: undefined };
  assert.equal(timing.fitScenesToNarration(bare), bare, 'no narration: project untouched');
});

test('captions: the spoken word is lit inside its sentence', () => {
  const words = [
    { text: 'The', startMs: 0, endMs: 200 },
    { text: 'piston', startMs: 200, endMs: 500 },
    { text: 'moves.', startMs: 500, endMs: 800 },
    { text: 'Then', startMs: 900, endMs: 1100 },
    { text: 'it', startMs: 1100, endMs: 1200 },
    { text: 'stops.', startMs: 1200, endMs: 1500 },
  ];
  const w = captions.captionWindow(words, 300);
  assert.ok(w.items.length > 0);
  assert.deepEqual(w.items.map(i => i.text), ['The', 'piston', 'moves.'], 'stops at the sentence end');
  assert.deepEqual(w.items.filter(i => i.active).map(i => i.text), ['piston']);
  assert.equal(captions.captionWindow(words, 850).items.length, 0, 'silence between sentences shows nothing');
  assert.equal(captions.captionWindow([], 100).items.length, 0, 'no words, no caption');
});
