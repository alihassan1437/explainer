// Google Cloud Text-to-Speech for the Explainer's own key: SSML with a time
// marker before every word, so the captions and word cues know exactly when
// each word is spoken. Pure helpers (no network) plus the synthesis itself.
// The key comes from GOOGLE_TTS_API_KEY; it never leaves the server.

export const SSML_MAX_BYTES = 4600; // Google rejects requests over 5,000 bytes
const SAMPLE_RATE = 24000;
const ENDPOINT = 'https://texttospeech.googleapis.com/v1beta1/text:synthesize';

export const escapeXml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

export const wordsOf = (text: string): string[] => text.split(/\s+/).filter(Boolean);

/** The text as SSML with a named marker before each word; Google reports the time of every marker. */
export const buildSsml = (words: string[]): string =>
  `<speak>${words.map((w, i) => `<mark name="w${i}"/>${escapeXml(w)}`).join(' ')}</speak>`;

const bytes = (s: string): number => Buffer.byteLength(s, 'utf8');

/** Splits a piece in two, at a sentence end or comma nearest the middle, until each part fits the request limit. */
export function fitToLimit(piece: string, maxBytes = SSML_MAX_BYTES): string[] {
  const words = wordsOf(piece);
  if (words.length < 2 || bytes(buildSsml(words)) <= maxBytes) return [piece];
  const mid = Math.floor(words.length / 2);
  let cut = mid, best = Infinity;
  for (let i = Math.max(1, Math.floor(words.length * 0.3)); i <= Math.min(words.length - 1, Math.ceil(words.length * 0.7)); i++) {
    const previous = words[i - 1];
    const bonus = /[.!?…]$/.test(previous) ? 0 : /[,;:]$/.test(previous) ? 4 : 12;
    const score = Math.abs(i - mid) + bonus;
    if (score < best) { best = score; cut = i; }
  }
  return [...fitToLimit(words.slice(0, cut).join(' '), maxBytes), ...fitToLimit(words.slice(cut).join(' '), maxBytes)];
}

/** The samples of a WAV file (16-bit PCM), skipping its header. Raw PCM with no header is returned as it is. */
export function wavToPcm(wav: Buffer): Buffer {
  if (wav.length < 12 || wav.toString('ascii', 0, 4) !== 'RIFF') return wav;
  let offset = 12;
  while (offset + 8 <= wav.length) {
    const id = wav.toString('ascii', offset, offset + 4);
    const size = wav.readUInt32LE(offset + 4);
    if (id === 'data') return wav.subarray(offset + 8, size ? Math.min(wav.length, offset + 8 + size) : wav.length);
    offset += 8 + size + (size % 2);
  }
  return wav.subarray(44);
}

export interface WordTime { text: string; startMs: number; endMs: number }

/**
 * Word times within one piece, from the marker times Google returned. A word
 * whose marker is missing is placed by its share of the text between the
 * markers around it, so the captions never lose a word.
 */
export function wordTimes(words: string[], marks: { markName: string; timeSeconds: number }[], pieceMs: number): WordTime[] {
  const at = new Map(marks.map(m => [m.markName, Math.round(m.timeSeconds * 1000)]));
  const starts: number[] = words.map((_, i) => at.get(`w${i}`) ?? NaN);
  for (let i = 0; i < starts.length; i++) {
    if (!Number.isNaN(starts[i])) continue;
    let a = i - 1; while (a >= 0 && Number.isNaN(starts[a])) a--;
    let b = i + 1; while (b < starts.length && Number.isNaN(starts[b])) b++;
    const from = a >= 0 ? starts[a] : 0, to = b < starts.length ? starts[b] : pieceMs;
    const first = Math.max(a, 0), last = b - 1;
    const weight = (k: number): number => Math.max(1, words[k].length);
    let total = 0; for (let k = first; k <= last; k++) total += weight(k);
    let before = 0; for (let k = first; k < i; k++) before += weight(k);
    starts[i] = Math.round(from + ((to - from) * before) / total);
  }
  return words.map((text, i) => ({ text, startMs: starts[i], endMs: i + 1 < words.length ? Math.max(starts[i], starts[i + 1]) : Math.max(starts[i], pieceMs) }));
}

/** About a minute of speech per piece: long single requests drift toward flat delivery. */
export const SPEECH_CHUNK_CHARS = 1100;

/** Splits a script into pieces at paragraph or sentence ends, so no sentence is cut in half. */
export function splitForSpeech(text: string, max = SPEECH_CHUNK_CHARS): string[] {
  const clean = text.replace(/\r\n/g, '\n').trim();
  if (!clean) return [];
  if (clean.length <= max) return [clean];
  const sentences: string[] = [];
  for (const paragraph of clean.split(/\n{2,}/)) {
    const parts = paragraph.replace(/\s*\n\s*/g, ' ').match(/[^.!?…]+(?:[.!?…]+["')\]]*|$)\s*/g) ?? [paragraph];
    parts.map(p => p.trim()).filter(Boolean).forEach(p => sentences.push(p));
    if (sentences.length) sentences[sentences.length - 1] += '\u0000';
  }
  const pieces: string[] = [];
  let current = '';
  const flush = (): void => { if (current.trim()) pieces.push(current.trim()); current = ''; };
  for (const raw of sentences) {
    const endsParagraph = raw.endsWith('\u0000');
    const sentence = raw.replace(/\u0000/g, '');
    if (sentence.length > max) {
      flush();
      let rest = sentence;
      while (rest.length > max) {
        let cut = rest.lastIndexOf(', ', max - 2); if (cut < max * 0.4) cut = rest.lastIndexOf(' ', max - 1); if (cut <= 0) cut = max - 1;
        pieces.push(rest.slice(0, cut + 1).trim()); rest = rest.slice(cut + 1);
      }
      current = rest.trim();
    } else if (current && current.length + 1 + sentence.length > max) { flush(); current = sentence; }
    else current = current ? `${current} ${sentence}` : sentence;
    if (endsParagraph && current.length >= max * 0.6) flush();
  }
  flush();
  return pieces;
}

/** Removes near-silence from both ends, keeping a few ms so words are not clipped. Returns the trimmed audio and how much lead was cut. */
export function trimSilence(pcm: Buffer, threshold = 250, keepMs = 40): { pcm: Buffer; leadTrimMs: number } {
  const n = Math.floor(pcm.length / 2);
  let a = 0, b = n - 1;
  while (a < n && Math.abs(pcm.readInt16LE(a * 2)) < threshold) a++;
  while (b > a && Math.abs(pcm.readInt16LE(b * 2)) < threshold) b--;
  const keep = Math.round((SAMPLE_RATE * keepMs) / 1000);
  const from = Math.max(0, a - keep), to = Math.min(n, b + 1 + keep);
  const lo = to > from ? from : 0, hi = to > from ? to : n;
  return { pcm: pcm.subarray(lo * 2, hi * 2), leadTrimMs: Math.round((lo / SAMPLE_RATE) * 1000) };
}

export interface StitchedPiece { startMs: number; lengthMs: number; leadTrimMs: number }

/** Joins piece PCM end to end, trimming edge silence; word times shift by each piece's start and its trimmed lead. */
export function stitchPcm(pieces: Buffer[]): { pcm: Buffer; parts: StitchedPiece[] } {
  const out: Buffer[] = [];
  const parts: StitchedPiece[] = [];
  let cursorMs = 0;
  for (const raw of pieces) {
    const { pcm, leadTrimMs } = trimSilence(raw);
    const lengthMs = Math.round((pcm.length / 2 / SAMPLE_RATE) * 1000);
    out.push(pcm);
    parts.push({ startMs: cursorMs, lengthMs, leadTrimMs });
    cursorMs += lengthMs;
  }
  return { pcm: Buffer.concat(out), parts };
}

function wavHeader(pcmLength: number): Buffer {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(36 + pcmLength, 4); header.write('WAVE', 8); header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22); header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write('data', 36); header.writeUInt32LE(pcmLength, 40);
  return header;
}

interface SynthResponse { audioContent?: string; timepoints?: { markName: string; timeSeconds: number }[] }

async function synthesizePiece(ssml: string, voice: string, language: string, apiKey: string): Promise<{ pcm: Buffer; words: WordTime[] }> {
  const words = wordsOf(ssml.replace(/<[^>]+>/g, ' '));
  const body = {
    input: { ssml },
    voice: { languageCode: language, name: voice },
    audioConfig: { audioEncoding: 'LINEAR16', sampleRateHertz: SAMPLE_RATE, speakingRate: 1 },
    enableTimePointing: ['SSML_MARK'],
  };
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${ENDPOINT}?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const data = (await res.json()) as SynthResponse & { error?: { message?: string; status?: string } };
    if (res.ok && data.audioContent) {
      const pcm = wavToPcm(Buffer.from(data.audioContent, 'base64'));
      const pieceMs = Math.round((pcm.length / 2 / SAMPLE_RATE) * 1000);
      return { pcm, words: wordTimes(words, data.timepoints ?? [], pieceMs) };
    }
    const status = res.status;
    if ((status === 429 || status >= 500) && attempt < 3) {
      await new Promise(r => setTimeout(r, 1200 * (attempt + 1)));
      continue;
    }
    console.error('Text-to-speech failed', status, JSON.stringify(data?.error ?? null).slice(0, 300));
    if (status === 400) throw new Error('The narration request was rejected. The text may contain something the voice service cannot read.');
    if (status === 403) throw new Error('The Google TTS key is not allowed to use Text-to-Speech. Enable the API for the key.');
    if (status === 429) throw new Error('Narration is very busy right now. Please try again in a minute.');
    throw new Error('The narration service could not create the audio. Please try again in a minute.');
  }
}

export interface Narration { wav: Buffer; durationMs: number; words: WordTime[]; voice: string; characters: number }

const PARALLEL = 3;

/** Reads the whole script aloud and returns one WAV with a time for every word. */
export async function synthesizeNarration(input: { text: string; voice: string; language: string; apiKey: string }): Promise<Narration> {
  const pieces = splitForSpeech(input.text).flatMap(p => fitToLimit(p));
  if (!pieces.length) throw new Error('There is no text to read.');
  const done: { pcm: Buffer; words: WordTime[] }[] = new Array(pieces.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(PARALLEL, pieces.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= pieces.length) return;
      done[i] = await synthesizePiece(buildSsml(wordsOf(pieces[i])), input.voice, input.language, input.apiKey);
    }
  }));
  const stitched = stitchPcm(done.map(d => d.pcm));
  const words: WordTime[] = done.flatMap((d, i) => {
    const place = stitched.parts[i];
    const shift = (ms: number): number => Math.max(0, Math.min(place.lengthMs, ms - place.leadTrimMs));
    return d.words.map(w => ({ text: w.text, startMs: place.startMs + shift(w.startMs), endMs: place.startMs + shift(w.endMs) }));
  });
  const durationMs = Math.round((stitched.pcm.length / 2 / SAMPLE_RATE) * 1000);
  const wav = Buffer.concat([wavHeader(stitched.pcm.length), stitched.pcm]);
  return { wav, durationMs, words, voice: input.voice, characters: input.text.length };
}
