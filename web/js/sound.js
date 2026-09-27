// sound.js — alert tones generated with the Web Audio API (no audio files needed).
// Browsers and Android's WebView only allow audio after the user has touched the
// page once, so the AudioContext is created/resumed on the first tap or key press.

let ctx = null;

function getContext() {
  if (!ctx) {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;
    ctx = new AudioCtx();
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

// Unlock audio on the first user gesture.
['pointerdown', 'keydown'].forEach((type) =>
  window.addEventListener(type, getContext, { once: true, capture: true })
);

const TONES = {
  beep:  [{ freq: 880, wave: 'sine', at: 0, len: 0.3 }],
  chime: [{ freq: 660, wave: 'triangle', at: 0, len: 0.25 }, { freq: 990, wave: 'triangle', at: 0.18, len: 0.4 }],
  buzz:  [{ freq: 180, wave: 'square', at: 0, len: 0.18 }, { freq: 180, wave: 'square', at: 0.25, len: 0.18 }],
};

export function playTone(name = 'beep') {
  const audio = getContext();
  if (!audio) return;
  try {
    for (const note of TONES[name] || TONES.beep) {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      const start = audio.currentTime + note.at;
      osc.type = note.wave;
      osc.frequency.value = note.freq;
      gain.gain.setValueAtTime(note.wave === 'square' ? 0.06 : 0.15, start);
      gain.gain.exponentialRampToValueAtTime(0.001, start + note.len);
      osc.connect(gain).connect(audio.destination);
      osc.start(start);
      osc.stop(start + note.len);
    }
  } catch (e) {
    console.warn('alert sound failed', e);
  }
}
