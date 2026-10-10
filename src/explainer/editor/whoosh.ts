// A soft synthesized whoosh for scene changes. Pure WebAudio, no files.

/** Plays a short band-swept noise whoosh on the given context. Never throws. */
export function playWhoosh(ac: AudioContext, volume = 0.22, destination?: AudioNode): void {
  try {
    if (ac.state === 'suspended') void ac.resume();
    const dur = 0.45;
    const buf = ac.createBuffer(1, Math.floor(ac.sampleRate * dur), ac.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    const src = ac.createBufferSource();
    src.buffer = buf;
    const filt = ac.createBiquadFilter();
    filt.type = 'bandpass'; filt.Q.value = 1.2;
    filt.frequency.setValueAtTime(400, ac.currentTime);
    filt.frequency.exponentialRampToValueAtTime(3200, ac.currentTime + dur);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, ac.currentTime);
    g.gain.exponentialRampToValueAtTime(volume, ac.currentTime + 0.08);
    g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + dur);
    src.connect(filt); filt.connect(g); g.connect(destination ?? ac.destination);
    src.start();
  } catch {
    // Sound effects are decoration; never break anything.
  }
}

/** A lazily-created shared AudioContext for UI sounds. */
let shared: AudioContext | null = null;
export function uiAudioContext(): AudioContext | null {
  try {
    shared ??= new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    return shared;
  } catch {
    return null;
  }
}
