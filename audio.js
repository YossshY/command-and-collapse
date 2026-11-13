/* ============================================================================
 * audio.js — Moteur audio procédural (WebAudio), version 2
 * ----------------------------------------------------------------------------
 * Aucun fichier externe : tout est synthétisé. Cette version corrige ce qui
 * fatiguait à l'écoute :
 *
 *  - la musique ne boucle plus sur 4 mesures : les grilles d'accords changent
 *    au hasard toutes les 8 mesures et la mélodie est générée phrase par phrase ;
 *  - elle est ADAPTATIVE : calme et aérienne au repos, les percussions
 *    n'entrent que lorsque ça tire (niveau d'intensité 0 → 1, qui retombe seul) ;
 *  - plus de dents de scie nasillardes : nappes douces (triangles + sinus),
 *    réverbération et écho pour l'espace, filtre doux sur la musique ;
 *  - effets sonores variés (hauteur aléatoire), limités en nombre de voix ;
 *  - compresseur général : plus de saturation quand dix chars tirent ensemble.
 *
 *   const audio = new AudioEngine();
 *   audio.init();                 // après un geste utilisateur
 *   audio.sfx('place');
 *   audio.setMusicVolume(0.4);
 * ========================================================================== */

const BPM = 72;
const STEP = 60 / BPM / 4;           // une double-croche
const STEPS_PER_BAR = 16;

const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

/** Accords en notes MIDI (basse en premier). */
const CH = {
  Am: [45, 48, 52, 57],
  Dm: [50, 53, 57, 62],
  Em: [40, 43, 47, 52],
  E:  [40, 44, 47, 52],
  F:  [41, 45, 48, 53],
  C:  [48, 52, 55, 60],
  G:  [43, 47, 50, 55]
};

/** Grilles de 4 accords (2 mesures chacun = 8 mesures). */
const PROGS = [
  ['Am', 'F', 'C', 'G'],
  ['Am', 'Dm', 'F', 'E'],
  ['Am', 'G', 'F', 'G'],
  ['Am', 'C', 'G', 'F'],
  ['F', 'G', 'Am', 'Am'],
  ['Am', 'Em', 'F', 'G']
];

/** La mineur naturel, de A3 à A5, pour la mélodie. */
const SCALE = [57, 59, 60, 62, 64, 65, 67, 69, 71, 72, 74, 76, 77, 79, 81];

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.musicBus = null;
    this.sfxBus = null;

    this.musicVol = 0.45;
    this.sfxVol = 0.55;
    this.musicOn = true;
    this.sfxOn = true;

    this._timer = null;
    this._nextTime = 0;
    this._step = 0;
    this._bar = 0;
    this._chordIdx = 0;
    this._prog = PROGS[0];
    this._chord = CH.Am;
    this._lastProg = -1;
    this._phrase = [];
    this._noiseBuf = null;
    this._shotTimes = [];

    /** Intensité du combat, 0 (calme) → 1 (bataille). Retombe toute seule. */
    this._level = 0;
  }

  /* ------------------------------------------------------------- cycle de vie */

  init() {
    if (this.ctx) { this.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.attach(new AC());
    this._nextTime = this.ctx.currentTime + 0.2;
    this._timer = setInterval(() => this._schedule(), 25);
  }

  /** Construit le graphe audio sur un contexte (temps réel ou hors-ligne). */
  attach(ctx) {
    this.ctx = ctx;

    // Sortie : compresseur pour que les superpositions ne saturent pas
    this.master = ctx.createGain();
    this.master.gain.value = 1;
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -16;
    this.comp.knee.value = 14;
    this.comp.ratio.value = 4;
    this.comp.attack.value = 0.004;
    this.comp.release.value = 0.22;
    this.master.connect(this.comp);
    this.comp.connect(ctx.destination);

    // Réverbération partagée (réponse impulsionnelle générée)
    this.reverbIn = ctx.createGain();
    const conv = ctx.createConvolver();
    conv.buffer = this._makeImpulse(2.4);
    const revOut = ctx.createGain();
    revOut.gain.value = 0.55;
    this.reverbIn.connect(conv);
    conv.connect(revOut);
    revOut.connect(this.master);

    // Musique : filtre doux + envoi réverbération
    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = this.musicOn ? this.musicVol : 0;
    const musicTone = ctx.createBiquadFilter();
    musicTone.type = 'lowpass';
    musicTone.frequency.value = 7200;
    musicTone.Q.value = 0.5;
    this.musicBus.connect(musicTone);
    musicTone.connect(this.master);
    const mSend = ctx.createGain();
    mSend.gain.value = 0.38;
    this.musicBus.connect(mSend);
    mSend.connect(this.reverbIn);

    // Écho en croche pointée pour la mélodie
    this.echoIn = ctx.createGain();
    const delay = ctx.createDelay(2);
    delay.delayTime.value = (60 / BPM) * 0.75;
    const fb = ctx.createGain();
    fb.gain.value = 0.36;
    const fbTone = ctx.createBiquadFilter();
    fbTone.type = 'lowpass';
    fbTone.frequency.value = 1900;
    const echoOut = ctx.createGain();
    echoOut.gain.value = 0.34;
    this.echoIn.connect(delay);
    delay.connect(fbTone);
    fbTone.connect(fb);
    fb.connect(delay);
    delay.connect(echoOut);
    echoOut.connect(this.musicBus);

    // Effets
    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = this.sfxOn ? this.sfxVol : 0;
    this.sfxBus.connect(this.master);
    const sSend = ctx.createGain();
    sSend.gain.value = 0.16;
    this.sfxBus.connect(sSend);
    sSend.connect(this.reverbIn);

    this._noiseBuf = this._makeNoise(2);
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

  /** Force l'intensité (0 → 1) : utile pour les tests ou un événement scénarisé. */
  setIntensity(v) { this._level = Math.max(0, Math.min(1, v)); }
  get intensity() { return this._level; }

  /* ------------------------------------------------------------ utilitaires */

  _makeNoise(seconds) {
    const len = Math.floor(this.ctx.sampleRate * seconds);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  /** Réponse impulsionnelle : bruit qui décroît en perdant ses aigus. */
  _makeImpulse(seconds) {
    const sr = this.ctx.sampleRate;
    const len = Math.floor(sr * seconds);
    const buf = this.ctx.createBuffer(2, len, sr);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const k = i / len;
        const x = (Math.random() * 2 - 1) * Math.pow(1 - k, 2.4);
        lp += (x - lp) * (0.62 - 0.52 * k);
        d[i] = lp;
      }
    }
    return buf;
  }

  _send(node, bus, wet) {
    node.connect(bus);
    if (wet > 0) {
      const w = this.ctx.createGain();
      w.gain.value = wet;
      node.connect(w);
      w.connect(this.reverbIn);
    }
  }

  /** Note synthétique avec enveloppe percussive. */
  _tone({ t, type = 'sine', f0, f1 = null, dur = 0.1, gain = 0.1, attack = 0.003,
          lp = 0, wet = 0, bus = null, detune = 0 }) {
    const c = this.ctx;
    const osc = c.createOscillator();
    osc.type = type;
    osc.detune.value = detune;
    osc.frequency.setValueAtTime(f0, t);
    if (f1 && f1 !== f0) osc.frequency.exponentialRampToValueAtTime(f1, t + dur);

    const env = c.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(gain, t + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    osc.connect(env);
    let out = env;
    if (lp) {
      const f = c.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = lp;
      env.connect(f);
      out = f;
    }
    this._send(out, bus || this.sfxBus, wet);
    osc.start(t);
    osc.stop(t + dur + 0.05);
    return out;
  }

  /** Souffle filtré (impacts, frappes, explosions). */
  _noise({ t, dur = 0.1, gain = 0.1, type = 'bandpass', f0 = 1000, f1 = null, q = 1,
           attack = 0.002, wet = 0, bus = null }) {
    const c = this.ctx;
    const src = c.createBufferSource();
    src.buffer = this._noiseBuf;

    const f = c.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    if (f1 && f1 !== f0) f.frequency.exponentialRampToValueAtTime(f1, t + dur);

    const env = c.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(gain, t + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    src.connect(f);
    f.connect(env);
    this._send(env, bus || this.sfxBus, wet);
    src.start(t, Math.random() * 0.8);
    src.stop(t + dur + 0.05);
  }

  /* ------------------------------------------------------------------ musique */

  _schedule() {
    if (!this.ctx) return;
    const ahead = document.hidden ? 1.6 : 0.35;     // onglet en arrière-plan : timers ralentis
    while (this._nextTime < this.ctx.currentTime + ahead) {
      this._playStep(this._nextTime);
      this._nextTime += STEP;
    }
  }

  /** Rend la musique dans l'intervalle [from, to] (contexte hors-ligne). */
  renderMusic(from, to, levelAt = null) {
    this._step = 0; this._bar = 0; this._chordIdx = 0; this._lastProg = -1;
    for (let t = from; t < to; t += STEP) {
      if (levelAt) this._level = levelAt(t);
      this._playStep(t);
    }
  }

  _nextChord(t) {
    if (this._chordIdx % 4 === 0) {
      let i;
      do { i = Math.floor(Math.random() * PROGS.length); } while (i === this._lastProg);
      this._lastProg = i;
      this._prog = PROGS[i];
    }
    this._chord = CH[this._prog[this._chordIdx % 4]];
    this._chordIdx++;

    const dur = STEP * STEPS_PER_BAR * 2;
    this._pad(this._chord, t, dur);
    this._drone(this._chord[0], t, dur);
    this._phrase = Math.random() < 0.7 ? this._makePhrase(this._chord) : [];
    this._phraseT0 = t;
  }

  _playStep(t) {
    const s = this._step;
    const lv = this._level;

    if (s === 0) {
      if (this._bar % 2 === 0) this._nextChord(t);
      this._bar++;
    }

    // Mélodie : on joue les notes de la phrase qui tombent sur ce pas
    if (this._phrase.length) {
      const pos = Math.round((t - this._phraseT0) / STEP);
      for (const n of this._phrase) {
        if (n.at === pos) this._pluck(midi(n.note), t, n.len * STEP, 0.07);
      }
    }

    // Percussions : elles n'entrent que quand ça chauffe
    if (lv > 0.12) {
      const v = Math.min(1, 0.35 + lv * 0.7);
      if (s === 0 || s === 10) this._drum(t, v);
      if (lv > 0.12 && s === 0) this._bassHit(this._chord[0], t, v);
    }
    if (lv > 0.35) {
      const v = Math.min(1, 0.3 + lv * 0.7);
      if (s === 6 || s === 14) this._taiko(t, v);
      if (s === 8) this._drum(t, v * 0.8);
    }
    if (lv > 0.6) {
      const v = Math.min(1, (lv - 0.4) * 1.5);
      if (s === 4 || s === 12) this._snare(t, v);
      this._shaker(t, 0.02 * v);
    }
    if (lv > 0.82 && s >= 13) this._snare(t, 0.5 + (s - 13) * 0.12);

    // Le combat s'apaise de lui-même (~33 s pour retomber de 1 à 0)
    this._level = Math.max(0, this._level - STEP * 0.03);

    this._step = (s + 1) % STEPS_PER_BAR;
  }

  /** Phrase de 3 à 5 notes, proche des notes de l'accord, sur 2 mesures. */
  _makePhrase(chord) {
    const isEmaj = chord.includes(44);                          // E majeur : sol dièse
    const fix = (n) => (isEmaj && n % 12 === 7 ? n + 1 : n);
    const tones = SCALE.filter((n) => chord.some((c) => (n - c) % 12 === 0));
    const len = 3 + Math.floor(Math.random() * 3);

    let idx = SCALE.indexOf(pick(tones.length ? tones : SCALE));
    let at = pick([0, 2, 4]);
    const out = [];

    for (let k = 0; k < len; k++) {
      const dur = pick([2, 4, 4, 6]);
      out.push({ at, note: fix(SCALE[idx]), len: dur + 2 });
      at += dur;
      if (at > 26) break;
      idx = Math.max(3, Math.min(SCALE.length - 2, idx + pick([-2, -1, -1, 1, 1, 2])));
    }

    // la dernière note retombe sur une note de l'accord
    const last = out[out.length - 1];
    if (last && tones.length) {
      let best = tones[0];
      for (const n of tones) if (Math.abs(n - last.note) < Math.abs(best - last.note)) best = n;
      last.note = fix(best);
    }
    return out;
  }

  _pad(chord, t, dur) {
    const c = this.ctx;
    const filter = c.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 0.7;
    filter.frequency.setValueAtTime(520, t);
    filter.frequency.linearRampToValueAtTime(1500, t + dur * 0.45);
    filter.frequency.linearRampToValueAtTime(600, t + dur);

    const env = c.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(0.085, t + dur * 0.3);
    env.gain.setValueAtTime(0.085, t + dur * 0.62);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur + 1.2);
    env.connect(filter);
    filter.connect(this.musicBus);

    for (const n of chord.slice(1)) {
      for (const detune of [-6, 6]) {
        const osc = c.createOscillator();
        osc.type = 'triangle';
        osc.frequency.value = midi(n + 12);
        osc.detune.value = detune;
        osc.connect(env);
        osc.start(t);
        osc.stop(t + dur + 1.4);
      }
    }
    const sub = c.createOscillator();
    sub.type = 'sine';
    sub.frequency.value = midi(chord[0] + 12);
    sub.connect(env);
    sub.start(t);
    sub.stop(t + dur + 1.4);
  }

  _drone(root, t, dur) {
    const c = this.ctx;
    const env = c.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(0.12, t + 1.6);
    env.gain.setValueAtTime(0.12, t + dur - 1.2);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur + 1.0);

    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 220;
    env.connect(lp);
    lp.connect(this.musicBus);

    const a = c.createOscillator();
    a.type = 'sine';
    a.frequency.value = midi(root);
    const b = c.createOscillator();
    b.type = 'sawtooth';                         // filtré à 220 Hz : donne du corps, pas de nasillement
    b.frequency.value = midi(root);
    b.detune.value = 5;
    const bg = c.createGain();
    bg.gain.value = 0.35;
    a.connect(env);
    b.connect(bg);
    bg.connect(env);
    for (const o of [a, b]) { o.start(t); o.stop(t + dur + 1.2); }
  }

  /** Note de mélodie : timbre de pizzicato doux envoyé dans l'écho. */
  _pluck(freq, t, dur, gain) {
    const c = this.ctx;
    const env = c.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(gain, t + 0.006);
    env.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(0.5, dur));

    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(3200, t);
    lp.frequency.exponentialRampToValueAtTime(900, t + 0.6);
    env.connect(lp);
    lp.connect(this.musicBus);
    lp.connect(this.echoIn);

    const o1 = c.createOscillator();
    o1.type = 'triangle';
    o1.frequency.value = freq;
    const o2 = c.createOscillator();
    o2.type = 'sine';
    o2.frequency.value = freq * 2;
    const g2 = c.createGain();
    g2.gain.value = 0.3;
    o1.connect(env);
    o2.connect(g2);
    g2.connect(env);
    for (const o of [o1, o2]) { o.start(t); o.stop(t + Math.max(0.5, dur) + 0.05); }
  }

  _bassHit(root, t, v) {
    this._tone({ t, type: 'triangle', f0: midi(root), dur: 0.55, gain: 0.3 * v,
                 attack: 0.01, lp: 400, bus: this.musicBus });
  }

  _drum(t, v) {
    this._tone({ t, f0: 140, f1: 52, dur: 0.24, gain: 0.7 * v, bus: this.musicBus });
    this._noise({ t, dur: 0.04, gain: 0.16 * v, type: 'lowpass', f0: 900, bus: this.musicBus });
  }

  _taiko(t, v) {
    this._tone({ t, f0: 100, f1: 40, dur: 0.5, gain: 0.9 * v, bus: this.musicBus, wet: 0.2 });
    this._noise({ t, dur: 0.12, gain: 0.28 * v, type: 'lowpass', f0: 520, bus: this.musicBus });
  }

  _snare(t, v) {
    this._noise({ t, dur: 0.13, gain: 0.24 * v, type: 'bandpass', f0: 1900, q: 0.6, bus: this.musicBus });
    this._tone({ t, type: 'triangle', f0: 200, f1: 140, dur: 0.08, gain: 0.14 * v, bus: this.musicBus });
  }

  _shaker(t, g) {
    this._noise({ t, dur: 0.035, gain: g, type: 'highpass', f0: 7500, bus: this.musicBus });
  }

  /* -------------------------------------------------------------------- effets */

  /** Les tirs et les explosions montent l'intensité de la musique. */
  _react(name) {
    if (name === 'shot') this._level = Math.min(1, this._level + 0.05);
    else if (name === 'explosion') this._level = Math.min(1, this._level + 0.15);
  }

  sfx(name) {
    this._react(name);
    if (!this.ctx || !this.sfxOn) return;
    this.sfxAt(name, this.ctx.currentTime + 0.001);
  }

  sfxAt(name, t) {
    const r = 1 + (Math.random() - 0.5) * 0.06;     // légère variation : jamais deux fois pareil
    switch (name) {
      case 'click':
        this._tone({ t, f0: 1500 * r, f1: 1000 * r, dur: 0.035, gain: 0.13, lp: 5000 });
        break;

      case 'select':
        this._tone({ t, type: 'triangle', f0: 760 * r, f1: 980 * r, dur: 0.07, gain: 0.12, lp: 4000 });
        break;

      case 'cancel':
        this._tone({ t, type: 'triangle', f0: 620 * r, f1: 340 * r, dur: 0.1, gain: 0.12, lp: 3000 });
        break;

      case 'place':
        this._tone({ t, f0: 170, f1: 55, dur: 0.28, gain: 0.5, wet: 0.1 });
        this._noise({ t, dur: 0.12, gain: 0.22, type: 'lowpass', f0: 1400, f1: 300 });
        [520, 1320, 2150].forEach((f, i) => {
          this._tone({ t: t + 0.012, f0: f * r, dur: 0.36 - i * 0.08, gain: 0.045, wet: 0.25 });
        });
        break;

      case 'ready':
        [[440, 0], [659.25, 0.13]].forEach(([f, d]) => {
          this._tone({ t: t + d, type: 'triangle', f0: f, dur: 0.55, gain: 0.17, wet: 0.3 });
          this._tone({ t: t + d, f0: f * 2, dur: 0.4, gain: 0.03, wet: 0.3 });
        });
        break;

      case 'cash':
        this._tone({ t, f0: 1568, dur: 0.12, gain: 0.14 });
        this._tone({ t: t + 0.07, f0: 2093, dur: 0.3, gain: 0.12, wet: 0.15 });
        break;

      case 'sell':
        this._tone({ t, f0: 1318, dur: 0.12, gain: 0.14 });
        this._tone({ t: t + 0.08, f0: 988, dur: 0.3, gain: 0.12, wet: 0.15 });
        break;

      case 'error':
        this._tone({ t, type: 'square', f0: 120, f1: 95, dur: 0.09, gain: 0.14, lp: 700 });
        this._tone({ t: t + 0.12, type: 'square', f0: 120, f1: 90, dur: 0.11, gain: 0.14, lp: 700 });
        break;

      case 'harvest':
        this._tone({ t, f0: 900 * r, f1: 1200 * r, dur: 0.05, gain: 0.07 });
        break;

      case 'explosion':
        this._tone({ t, f0: 85 * r, f1: 26, dur: 1.0, gain: 0.7, attack: 0.004, wet: 0.2 });
        this._noise({ t, dur: 0.9, gain: 0.55, type: 'lowpass', f0: 2600, f1: 90, wet: 0.35 });
        this._noise({ t, dur: 0.25, gain: 0.16, type: 'highpass', f0: 3200 });
        break;

      case 'shot': {
        // On limite les voix : au-delà de 5 tirs en 120 ms, le reste n'ajoute que du bruit
        const now = t;
        this._shotTimes = this._shotTimes.filter((x) => now - x < 0.12);
        if (this._shotTimes.length >= 5) break;
        this._shotTimes.push(now);

        if (Math.random() < 0.5) {            // canon
          this._noise({ t, dur: 0.11, gain: 0.09, type: 'bandpass', f0: rand(900, 1300), f1: 400, q: 1.1 });
          this._tone({ t, f0: 190 * r, f1: 55, dur: 0.11, gain: 0.14 });
        } else {                              // arme légère
          this._noise({ t, dur: 0.06, gain: 0.07, type: 'bandpass', f0: rand(1600, 2400), f1: 900, q: 1.4 });
          this._tone({ t, f0: 260 * r, f1: 90, dur: 0.05, gain: 0.06 });
        }
        break;
      }

      default: break;
    }
  }
}
