/* ============================================================================
 * audio.js — Moteur audio procédural (WebAudio)
 * ----------------------------------------------------------------------------
 * Aucun fichier externe : musique et effets sont synthétisés à la volée.
 * Cela évite tout problème de licence et garde le jeu 100 % autonome.
 *
 *   const audio = new AudioEngine();
 *   audio.init();                 // après un geste utilisateur
 *   audio.sfx('place');
 *   audio.setMusicVolume(0.4);
 * ========================================================================== */

const BPM = 84;
const STEPS_PER_BAR = 16;
const BARS = 4;

/** Progression mineure : Am – F – C – G (2 mesures par accord). */
const CHORDS = [
  [110.00, 130.81, 164.81], // A2 C3 E3
  [87.31, 110.00, 130.81],  // F2 A2 C3
  [130.81, 164.81, 196.00], // C3 E3 G3
  [98.00, 123.47, 146.83]   // G2 B2 D3
];

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.musicBus = null;
    this.sfxBus = null;

    this.musicVol = 0.30;
    this.sfxVol = 0.55;
    this.musicOn = true;
    this.sfxOn = true;

    this._timer = null;
    this._nextStep = 0;
    this._step = 0;
    this._noise = null;
  }

  /* ------------------------------------------------------------- cycle de vie */

  init() {
    if (this.ctx) { this.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;

    this.ctx = new AC();

    this.master = this.ctx.createGain();
    this.master.gain.value = 1;
    this.master.connect(this.ctx.destination);

    this.musicBus = this.ctx.createGain();
    this.musicBus.gain.value = this.musicOn ? this.musicVol : 0;
    this.musicBus.connect(this.master);

    this.sfxBus = this.ctx.createGain();
    this.sfxBus.gain.value = this.sfxOn ? this.sfxVol : 0;
    this.sfxBus.connect(this.master);

    this._noise = this._makeNoise();
    this._startMusic();
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  /* ----------------------------------------------------------------- réglages */

  setMusicVolume(v) {
    this.musicVol = Math.max(0, Math.min(1, v));
    if (this.musicBus) {
      this.musicBus.gain.setTargetAtTime(this.musicOn ? this.musicVol : 0, this.ctx.currentTime, 0.05);
    }
  }

  setSfxVolume(v) {
    this.sfxVol = Math.max(0, Math.min(1, v));
    if (this.sfxBus) {
      this.sfxBus.gain.setTargetAtTime(this.sfxOn ? this.sfxVol : 0, this.ctx.currentTime, 0.05);
    }
  }

  setMusicOn(on) {
    this.musicOn = !!on;
    if (this.musicBus) {
      this.musicBus.gain.setTargetAtTime(this.musicOn ? this.musicVol : 0, this.ctx.currentTime, 0.08);
    }
  }

  setSfxOn(on) {
    this.sfxOn = !!on;
    if (this.sfxBus) {
      this.sfxBus.gain.setTargetAtTime(this.sfxOn ? this.sfxVol : 0, this.ctx.currentTime, 0.05);
    }
  }

  /* ------------------------------------------------------------------ musique */

  _makeNoise() {
    const len = this.ctx.sampleRate * 1.0;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  _startMusic() {
    this._nextStep = this.ctx.currentTime + 0.15;
    this._step = 0;
    this._timer = setInterval(() => this._schedule(), 25);
  }

  _schedule() {
    if (!this.ctx) return;
    const stepDur = 60 / BPM / 4;
    while (this._nextStep < this.ctx.currentTime + 0.25) {
      this._playStep(this._step, this._nextStep, stepDur);
      this._nextStep += stepDur;
      this._step = (this._step + 1) % (STEPS_PER_BAR * BARS);
    }
  }

  _playStep(step, time, stepDur) {
    const bar = Math.floor(step / STEPS_PER_BAR);
    const inBar = step % STEPS_PER_BAR;
    const chord = CHORDS[Math.floor(bar / 2) % CHORDS.length];

    // Nappe : un accord toutes les 2 mesures
    if (inBar === 0 && bar % 2 === 0) {
      this._pad(chord, time, stepDur * STEPS_PER_BAR * 2);
    }

    // Basse sur les temps 1 et 3
    if (inBar === 0 || inBar === 8) {
      this._bass(chord[0] / 2, time, stepDur * 3);
    }

    // Grosse caisse
    if (inBar === 0 || inBar === 6 || inBar === 10) {
      this._kick(time);
    }

    // Charleston sur les contretemps
    if (inBar % 4 === 2) {
      this._hat(time, 0.05);
    }
  }

  _pad(freqs, time, dur) {
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(420, time);
    filter.frequency.linearRampToValueAtTime(1100, time + dur * 0.4);
    filter.frequency.linearRampToValueAtTime(500, time + dur);
    filter.Q.value = 1.2;
    filter.connect(this.musicBus);

    const env = this.ctx.createGain();
    env.gain.setValueAtTime(0.0001, time);
    env.gain.exponentialRampToValueAtTime(0.16, time + dur * 0.25);
    env.gain.exponentialRampToValueAtTime(0.0001, time + dur);
    env.connect(filter);

    for (const f of freqs) {
      for (const detune of [-7, 7]) {
        const osc = this.ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.value = f;
        osc.detune.value = detune;
        osc.connect(env);
        osc.start(time);
        osc.stop(time + dur + 0.1);
      }
    }
  }

  _bass(freq, time, dur) {
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq;

    const env = this.ctx.createGain();
    env.gain.setValueAtTime(0.0001, time);
    env.gain.exponentialRampToValueAtTime(0.22, time + 0.02);
    env.gain.exponentialRampToValueAtTime(0.0001, time + dur);

    osc.connect(env);
    env.connect(this.musicBus);
    osc.start(time);
    osc.stop(time + dur + 0.05);
  }

  _kick(time) {
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(130, time);
    osc.frequency.exponentialRampToValueAtTime(42, time + 0.13);

    const env = this.ctx.createGain();
    env.gain.setValueAtTime(0.5, time);
    env.gain.exponentialRampToValueAtTime(0.0001, time + 0.22);

    osc.connect(env);
    env.connect(this.musicBus);
    osc.start(time);
    osc.stop(time + 0.25);
  }

  _hat(time, gain) {
    const src = this.ctx.createBufferSource();
    src.buffer = this._noise;

    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 7000;

    const env = this.ctx.createGain();
    env.gain.setValueAtTime(gain, time);
    env.gain.exponentialRampToValueAtTime(0.0001, time + 0.05);

    src.connect(hp);
    hp.connect(env);
    env.connect(this.musicBus);
    src.start(time);
    src.stop(time + 0.06);
  }

  /* -------------------------------------------------------------------- effets */

  sfx(name) {
    if (!this.ctx || !this.sfxOn) return;
    const t = this.ctx.currentTime + 0.001;
    switch (name) {
      case 'click':     this._blip(620, 0.05, 'square', 0.10, t); break;
      case 'select':    this._blip(880, 0.04, 'triangle', 0.09, t); break;
      case 'place':     this._thud(t); break;
      case 'ready':     this._chime(t, 1); break;
      case 'cash':      this._chime(t, 1.5); break;
      case 'error':     this._buzz(t); break;
      case 'explosion': this._boom(t); break;
      case 'harvest':   this._blip(520, 0.09, 'sine', 0.07, t); break;
      case 'shot':      this._shot(t); break;
      default: break;
    }
  }

  _blip(freq, dur, type, gain, time) {
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, time);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.7, time + dur);

    const env = this.ctx.createGain();
    env.gain.setValueAtTime(gain, time);
    env.gain.exponentialRampToValueAtTime(0.0001, time + dur);

    osc.connect(env);
    env.connect(this.sfxBus);
    osc.start(time);
    osc.stop(time + dur + 0.02);
  }

  _thud(time) {
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(220, time);
    osc.frequency.exponentialRampToValueAtTime(70, time + 0.18);

    const env = this.ctx.createGain();
    env.gain.setValueAtTime(0.35, time);
    env.gain.exponentialRampToValueAtTime(0.0001, time + 0.25);

    osc.connect(env);
    env.connect(this.sfxBus);
    osc.start(time);
    osc.stop(time + 0.28);
  }

  _chime(time, mult = 1) {
    [660, 880, 1320].forEach((f, i) => {
      const osc = this.ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = f * mult;

      const env = this.ctx.createGain();
      const t0 = time + i * 0.07;
      env.gain.setValueAtTime(0.0001, t0);
      env.gain.exponentialRampToValueAtTime(0.12, t0 + 0.01);
      env.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.35);

      osc.connect(env);
      env.connect(this.sfxBus);
      osc.start(t0);
      osc.stop(t0 + 0.4);
    });
  }

  _buzz(time) {
    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(140, time);
    osc.frequency.linearRampToValueAtTime(90, time + 0.2);

    const env = this.ctx.createGain();
    env.gain.setValueAtTime(0.14, time);
    env.gain.exponentialRampToValueAtTime(0.0001, time + 0.22);

    osc.connect(env);
    env.connect(this.sfxBus);
    osc.start(time);
    osc.stop(time + 0.25);
  }

  _boom(time) {
    const src = this.ctx.createBufferSource();
    src.buffer = this._noise;

    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(1800, time);
    lp.frequency.exponentialRampToValueAtTime(120, time + 0.5);

    const env = this.ctx.createGain();
    env.gain.setValueAtTime(0.5, time);
    env.gain.exponentialRampToValueAtTime(0.0001, time + 0.6);

    src.connect(lp);
    lp.connect(env);
    env.connect(this.sfxBus);
    src.start(time);
    src.stop(time + 0.65);
  }

  _shot(time) {
    const src = this.ctx.createBufferSource();
    src.buffer = this._noise;

    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1400;
    bp.Q.value = 0.8;

    const env = this.ctx.createGain();
    env.gain.setValueAtTime(0.10, time);
    env.gain.exponentialRampToValueAtTime(0.0001, time + 0.09);

    src.connect(bp);
    bp.connect(env);
    env.connect(this.sfxBus);
    src.start(time);
    src.stop(time + 0.1);
  }
}
