/* ChordTab core: 音声・MIDI からコード進行を推定し、ギターの押さえ方と TAB を作る。
   DOM に依存しない部分だけをここに置く(index.html と tests.html の両方から使う)。 */
(function (root) {
  'use strict';

  /* ---------- 音楽の基礎データ ---------- */
  const SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
  const FLAT_MAJOR_KEYS = new Set([1, 3, 5, 8, 10]);

  const QUALITIES = {
    maj: { suffix: '', iv: [0, 4, 7], penalty: 0 },
    min: { suffix: 'm', iv: [0, 3, 7], penalty: 0 },
    '7': { suffix: '7', iv: [0, 4, 7, 10], penalty: 0.012 },
    maj7: { suffix: 'maj7', iv: [0, 4, 7, 11], penalty: 0.02 },
    m7: { suffix: 'm7', iv: [0, 3, 7, 10], penalty: 0.012 },
    sus4: { suffix: 'sus4', iv: [0, 5, 7], penalty: 0.03 },
    dim: { suffix: 'dim', iv: [0, 3, 6], penalty: 0.04 },
    aug: { suffix: 'aug', iv: [0, 4, 8], penalty: 0.05 },
    m7b5: { suffix: 'm7(b5)', iv: [0, 3, 6, 10], penalty: 0.04 },
  };
  const VOCABULARIES = {
    simple: ['maj', 'min'],
    standard: ['maj', 'min', '7', 'maj7', 'm7', 'sus4', 'dim'],
    detailed: ['maj', 'min', '7', 'maj7', 'm7', 'sus4', 'dim', 'aug', 'm7b5'],
  };

  const mod12 = (n) => ((n % 12) + 12) % 12;

  /** 調から #/b どちらで書くかを決める。mode は 'major' | 'minor'。 */
  function usesFlats(tonic, mode) {
    const major = mode === 'minor' ? mod12(tonic + 3) : mod12(tonic);
    return FLAT_MAJOR_KEYS.has(major);
  }
  const noteName = (pc, flats) => (flats ? FLAT : SHARP)[mod12(pc)];
  function chordName(chord, flats) {
    if (!chord) return 'N.C.';
    return noteName(chord.root, flats) + QUALITIES[chord.q].suffix;
  }
  const sameChord = (a, b) => (!a && !b) || (a && b && a.root === b.root && a.q === b.q);

  /* ---------- ギターのフォーム ---------- */
  const STANDARD_TUNING = [40, 45, 50, 55, 59, 64]; // 6弦(低)→1弦(高) の MIDI ノート番号

  // 開放弦を使う定番フォーム。文字列は 6弦→1弦。cost は押さえにくさ。
  const OPEN = {
    '0:maj': ['x32010', 0], '2:maj': ['xx0232', 0], '4:maj': ['022100', 0],
    '5:maj': ['133211', 2], '7:maj': ['320003', 0], '9:maj': ['x02220', 0],
    '2:min': ['xx0231', 0], '4:min': ['022000', 0], '9:min': ['x02210', 0],
    '0:7': ['x32310', 0.5], '2:7': ['xx0212', 0], '4:7': ['020100', 0],
    '5:7': ['131211', 2], '7:7': ['320001', 0], '9:7': ['x02020', 0], '11:7': ['x21202', 0.5],
    '2:m7': ['xx0211', 0], '4:m7': ['020000', 0], '9:m7': ['x02010', 0],
    '0:maj7': ['x32000', 0], '2:maj7': ['xx0222', 0], '4:maj7': ['021100', 0],
    '5:maj7': ['xx3210', 0.5], '7:maj7': ['320002', 0], '9:maj7': ['x02120', 0],
    '0:sus4': ['x33011', 0.5], '2:sus4': ['xx0233', 0], '4:sus4': ['022200', 0],
    '7:sus4': ['330013', 0.5], '9:sus4': ['x02230', 0],
    '2:dim': ['xx0131', 1],
  };
  // 移動できるフォーム。数字は根音のフレットからの相対位置、null はミュート。
  const E_FORM = {
    maj: [0, 2, 2, 1, 0, 0], min: [0, 2, 2, 0, 0, 0], '7': [0, 2, 0, 1, 0, 0],
    m7: [0, 2, 0, 0, 0, 0], maj7: [0, null, 1, 1, 0, null], sus4: [0, 2, 2, 2, 0, 0],
  };
  const A_FORM = {
    maj: [null, 0, 2, 2, 2, 0], min: [null, 0, 2, 2, 1, 0], '7': [null, 0, 2, 0, 2, 0],
    m7: [null, 0, 2, 0, 1, 0], maj7: [null, 0, 2, 1, 2, 0], sus4: [null, 0, 2, 2, 3, 0],
    dim: [null, 0, 1, 2, 1, null], aug: [null, 0, 3, 2, 2, 1], m7b5: [null, 0, 1, 0, 1, null],
  };

  function movable(form, stringIdx, root) {
    const openPc = STANDARD_TUNING[stringIdx] % 12;
    let fret = mod12(root - openPc);
    if (fret === 0) fret = 12; // 開放は OPEN 側の担当なので 12 フレットへ
    return { frets: form.map((f) => (f === null ? null : f + fret)), base: fret };
  }

  // 初級向け: セーハを避け、1〜4弦だけで押さえるフォーム
  const EASY = {
    '5:maj': 'xx3211', '10:maj': 'xx3331', '11:maj': 'xx4442', '1:maj': 'xx3121',
    '3:maj': 'xx5343', '6:maj': 'xx4322', '8:maj': 'xx6544',
    '11:min': 'xx4432', '6:min': 'xx4222', '1:min': 'xx2120', '0:min': 'xx5543',
    '5:min': 'xx3111', '7:min': 'xx5333', '10:min': 'xx3321', '3:min': 'xx4342', '8:min': 'xx6444',
  };

  /** root(0-11)+quality のフォームを返す。{frets:[6弦..1弦], cost, barre} */
  function getVoicing(root, q, easy) {
    const key = mod12(root) + ':' + q;
    if (easy && EASY[key]) {
      const frets = [...EASY[key]].map((c) => (c === 'x' ? null : Number(c)));
      return { frets, cost: 1 + Math.max(...frets.filter((f) => f !== null)) * 0.1, barre: null };
    }
    if (OPEN[key]) {
      const [s, cost] = OPEN[key];
      const frets = [...s].map((c) => (c === 'x' ? null : Number(c)));
      return { frets, cost, barre: s === '133211' || s === '131211' ? 1 : null };
    }
    const candidates = [];
    if (E_FORM[q]) candidates.push(movable(E_FORM[q], 0, root));
    if (A_FORM[q]) candidates.push(movable(A_FORM[q], 1, root));
    candidates.sort((a, b) => a.base - b.base);
    const best = candidates[0];
    return { frets: best.frets, cost: 3 + best.base * 0.25, barre: best.base };
  }

  /** そのフォームが鳴らす音名の集合(テスト用) */
  function voicingPitchClasses(v) {
    const out = new Set();
    v.frets.forEach((f, i) => { if (f !== null) out.add((STANDARD_TUNING[i] + f) % 12); });
    return out;
  }

  /** 押さえやすさでカポ位置を選ぶ。chords は変化ごとの和音の配列。 */
  function recommendCapo(chords, maxCapo, easy) {
    maxCapo = maxCapo === undefined ? 7 : maxCapo;
    const list = chords.filter(Boolean);
    if (!list.length) return { capo: 0, costs: [] };
    const costs = [];
    for (let capo = 0; capo <= maxCapo; capo++) {
      let sum = 0;
      for (const c of list) sum += getVoicing(c.root - capo, c.q, easy).cost;
      costs.push(sum / list.length + capo * 0.1);
    }
    let capo = 0;
    for (let i = 1; i <= maxCapo; i++) if (costs[i] < costs[capo]) capo = i;
    // 僅差ならカポなしのほうが親切
    if (capo !== 0 && costs[0] - costs[capo] < 0.4) capo = 0;
    return { capo, costs };
  }

  /* ---------- FFT ---------- */
  function makeFFT(N) {
    const rev = new Uint32Array(N);
    const bits = Math.log2(N);
    for (let i = 0; i < N; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) if (i & (1 << b)) r |= 1 << (bits - 1 - b);
      rev[i] = r;
    }
    const cos = new Float64Array(N / 2), sin = new Float64Array(N / 2);
    for (let i = 0; i < N / 2; i++) { cos[i] = Math.cos((2 * Math.PI * i) / N); sin[i] = -Math.sin((2 * Math.PI * i) / N); }
    const re = new Float64Array(N), im = new Float64Array(N);
    const win = new Float64Array(N);
    for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);
    /** samples[offset..offset+N] の振幅スペクトルを mag に書き込む */
    return function magnitude(samples, offset, mag) {
      for (let i = 0; i < N; i++) {
        const j = rev[i];
        re[j] = (samples[offset + i] || 0) * win[i];
        im[j] = 0;
      }
      for (let size = 2; size <= N; size *= 2) {
        const half = size / 2, step = N / size;
        for (let start = 0; start < N; start += size) {
          for (let k = 0; k < half; k++) {
            const a = start + k, b = a + half, t = k * step;
            const xr = re[b] * cos[t] - im[b] * sin[t];
            const xi = re[b] * sin[t] + im[b] * cos[t];
            re[b] = re[a] - xr; im[b] = im[a] - xi;
            re[a] += xr; im[a] += xi;
          }
        }
      }
      for (let k = 0; k < mag.length; k++) mag[k] = Math.hypot(re[k], im[k]);
    };
  }

  const tick = () => new Promise((r) => setTimeout(r, 0));

  /* ---------- 拍の検出 ---------- */
  async function onsetEnvelope(samples, sr, onProgress) {
    const N = 1024, hop = 256;
    const frames = Math.max(0, Math.floor((samples.length - N) / hop));
    const fft = makeFFT(N);
    let prev = new Float64Array(N / 2), cur = new Float64Array(N / 2);
    const env = new Float64Array(frames);
    for (let t = 0; t < frames; t++) {
      fft(samples, t * hop, cur);
      let flux = 0;
      for (let k = 1; k < cur.length; k++) {
        const v = Math.log1p(10 * cur[k]);
        const d = v - prev[k];
        if (d > 0 && t > 0) flux += d;
        prev[k] = v;
      }
      env[t] = flux;
      if (t % 1500 === 0) { onProgress && onProgress(0.3 * (t / frames)); await tick(); }
    }
    // 局所平均を引いて半波整流し、標準偏差で正規化
    const w = 32, out = new Float64Array(frames);
    let acc = 0;
    for (let t = 0; t < frames; t++) {
      acc += env[t];
      if (t > w) acc -= env[t - w - 1];
      out[t] = Math.max(0, env[t] - acc / Math.min(t + 1, w + 1));
    }
    let mean = 0, sq = 0;
    for (const v of out) { mean += v; sq += v * v; }
    mean /= frames || 1;
    const std = Math.sqrt(Math.max(1e-12, sq / (frames || 1) - mean * mean));
    for (let t = 0; t < frames; t++) out[t] /= std;
    return { env: out, frameRate: sr / hop, hop, N };
  }

  function estimatePeriod(env, frameRate) {
    const minLag = Math.floor((frameRate * 60) / 200), maxLag = Math.ceil((frameRate * 60) / 40);
    const ac = new Float64Array(maxLag * 4 + 2);
    const n = env.length;
    // 鋭いピークのままだと整数ラグに乗らないテンポを取りこぼすので、ならしてから相関を取る
    const smooth = new Float64Array(n);
    const kernel = [0.06, 0.24, 0.4, 0.24, 0.06];
    for (let t = 2; t < n - 2; t++) for (let k = 0; k < 5; k++) smooth[t] += env[t + k - 2] * kernel[k];
    for (let lag = minLag; lag < ac.length; lag++) {
      let s = 0;
      for (let t = lag; t < n; t++) s += smooth[t] * smooth[t - lag];
      ac[lag] = s / Math.max(1, n - lag);
    }
    let best = minLag, bestScore = -Infinity;
    for (let lag = minLag; lag <= maxLag; lag++) {
      const bpm = (60 * frameRate) / lag;
      const prior = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 115) / 0.9, 2));
      const score = (ac[lag] + 0.5 * ac[lag * 2] + 0.25 * ac[lag * 4]) * prior;
      if (score > bestScore) { bestScore = score; best = lag; }
    }
    // キック/スネアの周期(2拍)を拾うと半分のテンポになるので、倍テンポにも十分な周期性があればそちらを採る
    if ((60 * frameRate) / best < 90) {
      const half = Math.round(best / 2);
      let peak = half;
      for (let l = half - 1; l <= half + 1; l++) if (l >= minLag && ac[l] > ac[peak]) peak = l;
      // 160 BPM を超える倍テンポは、8分音符の刻みを拍と取り違えている場合がほとんど
      if (peak >= minLag && (60 * frameRate) / peak <= 160 && ac[peak] >= 0.5 * ac[best]) best = peak;
    }
    const a = ac[best - 1], b = ac[best], c = ac[best + 1];
    const denom = a - 2 * b + c;
    return best + (denom !== 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / denom)) : 0);
  }

  function trackBeats(env, period) {
    const n = env.length, tightness = 100;
    const score = new Float64Array(n), from = new Int32Array(n).fill(-1);
    const lo = Math.round(period / 2), hi = Math.round(period * 2);
    for (let t = 0; t < n; t++) {
      let bestV = -Infinity, bestI = -1;
      for (let p = t - hi; p <= t - lo; p++) {
        if (p < 0) continue;
        const l = Math.log((t - p) / period);
        const v = score[p] - tightness * l * l;
        if (v > bestV) { bestV = v; bestI = p; }
      }
      if (bestI >= 0 && bestV > 0) { score[t] = env[t] + bestV; from[t] = bestI; } else score[t] = env[t];
    }
    let last = n - 1, bestEnd = -Infinity;
    for (let t = Math.max(0, n - Math.round(period * 2)); t < n; t++) {
      if (score[t] > bestEnd) { bestEnd = score[t]; last = t; }
    }
    const beats = [];
    for (let t = last; t >= 0; t = from[t]) beats.push(t);
    return beats.reverse();
  }

  /* ---------- 音声の特徴量 ---------- */
  async function chromaFrames(samples, sr, onProgress) {
    const N = 4096, hop = 1024;
    const frames = Math.max(1, Math.floor((samples.length - N) / hop) + 1);
    const fft = makeFFT(N);
    const kMax = Math.min(N / 2 - 2, Math.ceil((2100 * N) / sr));
    const kMin = Math.max(2, Math.floor((40 * N) / sr));
    const mag = new Float64Array(kMax + 2);
    const peaks = new Array(frames);
    let tuneX = 0, tuneY = 0;
    for (let t = 0; t < frames; t++) {
      fft(samples, t * hop, mag);
      let max = 0;
      for (let k = kMin; k <= kMax; k++) if (mag[k] > max) max = mag[k];
      const list = [];
      const floor = max * 0.02;
      if (max > 1e-5) {
        for (let k = kMin; k <= kMax; k++) {
          const b = mag[k];
          if (b < floor || b <= mag[k - 1] || b < mag[k + 1]) continue;
          const la = Math.log(mag[k - 1] + 1e-12), lb = Math.log(b + 1e-12), lc = Math.log(mag[k + 1] + 1e-12);
          const d = la - 2 * lb + lc;
          const off = d !== 0 ? (0.5 * (la - lc)) / d : 0;
          const freq = ((k + off) * sr) / N;
          list.push(freq, b);
          if (freq > 150 && freq < 1500) {
            const pitch = 69 + 12 * Math.log2(freq / 440);
            const ang = 2 * Math.PI * (pitch - Math.round(pitch));
            tuneX += b * Math.cos(ang); tuneY += b * Math.sin(ang);
          }
        }
      }
      peaks[t] = list;
      if (t % 200 === 0) { onProgress && onProgress(0.3 + 0.6 * (t / frames)); await tick(); }
    }
    const tuning = Math.atan2(tuneY, tuneX) / (2 * Math.PI); // 半音単位のズレ
    const treble = new Array(frames), bass = new Array(frames), energy = new Float64Array(frames);
    for (let t = 0; t < frames; t++) {
      const tr = new Float64Array(12), ba = new Float64Array(12);
      const list = peaks[t];
      for (let i = 0; i < list.length; i += 2) {
        const f = list[i], m = list[i + 1];
        const pitch = 69 + 12 * Math.log2(f / 440) - tuning;
        const near = Math.round(pitch), dev = pitch - near;
        const w = Math.pow(Math.cos(Math.PI * dev), 2);
        const pc = mod12(near);
        if (f >= 110 && f <= 2000) {
          const roll = f <= 1000 ? 1 : (2000 - f) / 1000;
          tr[pc] += m * w * roll;
          energy[t] += m * w * roll;
        }
        if (f >= 40 && f <= 250) ba[pc] += m * w;
      }
      treble[t] = tr; bass[t] = ba;
    }
    return { treble, bass, energy, tuning, frameTime: (t) => (t * hop + N / 2) / sr, frames };
  }

  function median(values) {
    const a = Array.from(values).sort((x, y) => x - y);
    if (!a.length) return 0;
    const m = a.length >> 1;
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  }

  /** 音声サンプルから、拍ごとの特徴量を作る */
  async function extractAudioFeatures(samples, sr, onProgress, tempoScale) {
    if (samples.length < sr * 2) throw new Error('音声が短すぎます(2秒以上必要です)');
    const onset = await onsetEnvelope(samples, sr, onProgress);
    const period = estimatePeriod(onset.env, onset.frameRate) * (tempoScale || 1);
    const beatFrames = trackBeats(onset.env, period);
    const toTime = (f) => (f * onset.hop + onset.N / 2) / sr;
    const duration = samples.length / sr;
    let beats = beatFrames.map(toTime);
    const step = period / onset.frameRate;
    if (!beats.length) beats = [0];
    while (beats[0] - step > 0) beats.unshift(beats[0] - step);
    while (beats[beats.length - 1] + step < duration) beats.push(beats[beats.length - 1] + step);

    const ch = await chromaFrames(samples, sr, onProgress);
    onProgress && onProgress(0.92);
    const n = beats.length;
    const chroma = [], bass = [], energy = new Float64Array(n), onsetAt = new Float64Array(n);
    let f = 0;
    for (let b = 0; b < n; b++) {
      const start = beats[b], end = b + 1 < n ? beats[b + 1] : duration;
      while (f < ch.frames && ch.frameTime(f) < start) f++;
      let g = f;
      const idx = [];
      while (g < ch.frames && ch.frameTime(g) < end) idx.push(g++);
      if (!idx.length) idx.push(Math.min(ch.frames - 1, f));
      const c = new Float64Array(12), ba = new Float64Array(12);
      for (let pc = 0; pc < 12; pc++) {
        c[pc] = median(idx.map((i) => ch.treble[i][pc]));
        ba[pc] = median(idx.map((i) => ch.bass[i][pc]));
      }
      chroma.push(c); bass.push(ba);
      energy[b] = median(idx.map((i) => ch.energy[i]));
      const of = Math.round((start * sr - onset.N / 2) / onset.hop);
      for (let i = Math.max(0, of - 2); i <= of + 2 && i < onset.env.length; i++) onsetAt[b] = Math.max(onsetAt[b], onset.env[i]);
    }
    // 振幅を対数で圧縮(大きい音だけに引っ張られないように)
    const peak = Math.max(1e-9, ...chroma.map((c) => Math.max(...c)));
    chroma.forEach((c) => { for (let i = 0; i < 12; i++) c[i] = Math.log1p((20 * c[i]) / peak); });
    return {
      source: 'audio', beats, chroma, bass, energy, onsetAt, duration, harmonic: true,
      bpm: beatFrames.length > 1 ? (60 * (beatFrames.length - 1) * sr) / onset.hop / (beatFrames[beatFrames.length - 1] - beatFrames[0]) : 60 / step,
      tuningCents: Math.round(ch.tuning * 100),
      beatsPerBar: 4, knownPhase: null, warnings: [],
    };
  }

  /* ---------- MIDI ---------- */
  function parseMidi(buffer) {
    const d = new DataView(buffer);
    let p = 0;
    const tag = () => String.fromCharCode(d.getUint8(p), d.getUint8(p + 1), d.getUint8(p + 2), d.getUint8(p + 3));
    if (buffer.byteLength < 14 || tag() !== 'MThd') throw new Error('MIDI ファイルとして読めませんでした');
    const headerLen = d.getUint32(4);
    const division = d.getInt16(12);
    if (division <= 0) throw new Error('SMPTE 形式の MIDI には対応していません');
    const trackCount = d.getUint16(10);
    p = 8 + headerLen;
    const notes = [], tempos = [{ tick: 0, us: 500000 }], signatures = [];
    for (let tr = 0; tr < trackCount && p + 8 <= buffer.byteLength; tr++) {
      const isTrack = tag() === 'MTrk';
      const len = d.getUint32(p + 4);
      p += 8;
      const end = Math.min(p + len, buffer.byteLength);
      if (!isTrack) { p = end; continue; }
      const on = new Map();
      let tick = 0, status = 0;
      const vlq = () => {
        let v = 0, b;
        do { b = d.getUint8(p++); v = (v << 7) | (b & 0x7f); } while (b & 0x80);
        return v;
      };
      while (p < end) {
        tick += vlq();
        let b = d.getUint8(p);
        if (b & 0x80) { status = b; p++; }
        const type = status & 0xf0, ch = status & 0x0f;
        if (status === 0xff) {
          const meta = d.getUint8(p++), l = vlq();
          if (meta === 0x51 && l === 3) tempos.push({ tick, us: (d.getUint8(p) << 16) | (d.getUint8(p + 1) << 8) | d.getUint8(p + 2) });
          if (meta === 0x58 && l >= 2) signatures.push({ tick, num: d.getUint8(p), den: 1 << d.getUint8(p + 1) });
          p += l;
        } else if (status === 0xf0 || status === 0xf7) {
          const l = vlq(); p += l;
        } else if (type === 0x90 || type === 0x80) {
          const pitch = d.getUint8(p++), vel = d.getUint8(p++);
          const k = ch * 128 + pitch;
          if (type === 0x90 && vel > 0) {
            if (!on.has(k)) on.set(k, []);
            on.get(k).push({ tick, vel });
          } else if (on.has(k) && on.get(k).length) {
            const st = on.get(k).shift();
            if (ch !== 9) notes.push({ pitch, vel: st.vel, startTick: st.tick, endTick: tick });
          }
        } else if (type === 0xa0 || type === 0xb0 || type === 0xe0) p += 2;
        else if (type === 0xc0 || type === 0xd0) p += 1;
        else throw new Error('MIDI ファイルが壊れている可能性があります');
      }
      p = end;
    }
    if (!notes.length) throw new Error('この MIDI には音符がありません(ドラムのみの可能性があります)');
    tempos.sort((a, b) => a.tick - b.tick);
    signatures.sort((a, b) => a.tick - b.tick);
    // tick → 秒
    const segs = [];
    let sec = 0;
    tempos.forEach((t, i) => {
      if (i > 0) sec += ((t.tick - tempos[i - 1].tick) * tempos[i - 1].us) / 1e6 / division;
      segs.push({ tick: t.tick, sec, us: t.us });
    });
    const tickToSec = (tk) => {
      let lo = 0, hi = segs.length - 1;
      while (lo < hi) { const m = (lo + hi + 1) >> 1; if (segs[m].tick <= tk) lo = m; else hi = m - 1; }
      return segs[lo].sec + ((tk - segs[lo].tick) * segs[lo].us) / 1e6 / division;
    };
    notes.forEach((n) => { n.start = tickToSec(n.startTick); n.end = tickToSec(n.endTick); });
    return { notes, division, tempos, signatures, tickToSec };
  }

  function extractMidiFeatures(midi) {
    const sig = midi.signatures[0] || { num: 4, den: 4 };
    const beatTicks = (midi.division * 4) / sig.den;
    const lastTick = Math.max(...midi.notes.map((n) => n.endTick));
    const n = Math.max(1, Math.ceil(lastTick / beatTicks));
    const beats = [], chroma = [], bass = [], energy = new Float64Array(n);
    for (let b = 0; b < n; b++) {
      beats.push(midi.tickToSec(b * beatTicks));
      chroma.push(new Float64Array(12)); bass.push(new Float64Array(12));
    }
    const lowest = new Array(n).fill(128);
    for (const note of midi.notes) {
      const first = Math.floor(note.startTick / beatTicks);
      const last = Math.min(n - 1, Math.floor((note.endTick - 1) / beatTicks));
      for (let b = first; b <= last; b++) if (note.pitch < lowest[b]) lowest[b] = note.pitch;
    }
    for (const note of midi.notes) {
      const first = Math.floor(note.startTick / beatTicks);
      const last = Math.min(n - 1, Math.floor((note.endTick - 1) / beatTicks));
      for (let b = first; b <= last; b++) {
        const overlap = (Math.min(note.endTick, (b + 1) * beatTicks) - Math.max(note.startTick, b * beatTicks)) / beatTicks;
        const w = overlap * (note.vel / 127);
        chroma[b][note.pitch % 12] += w;
        energy[b] += w;
        if (note.pitch < 55 || note.pitch === lowest[b]) bass[b][note.pitch % 12] += w;
      }
    }
    chroma.forEach((c) => { for (let i = 0; i < 12; i++) c[i] = Math.log1p(4 * c[i]); });
    const warnings = [];
    if (new Set(midi.signatures.map((s) => s.num + '/' + s.den)).size > 1) {
      warnings.push(`途中で拍子が変わる曲ですが、最初の ${sig.num}/${sig.den} として小節を区切っています`);
    }
    return {
      source: 'midi', beats, chroma, bass, energy, onsetAt: new Float64Array(n),
      duration: Math.max(...midi.notes.map((x) => x.end)), harmonic: false,
      bpm: 6e7 / midi.tempos[midi.tempos.length > 1 && midi.tempos[0].tick === midi.tempos[1].tick ? 1 : 0].us,
      tuningCents: 0, beatsPerBar: sig.num, knownPhase: 0, warnings,
    };
  }

  /* ---------- 調の推定 ---------- */
  const KS_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
  const KS_MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
  function correlation(a, b, shift) {
    const n = 12;
    let ma = 0, mb = 0;
    for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
    ma /= n; mb /= n;
    let s = 0, sa = 0, sb = 0;
    for (let i = 0; i < n; i++) {
      const x = a[(i + shift) % n] - ma, y = b[i] - mb;
      s += x * y; sa += x * x; sb += y * y;
    }
    return s / Math.sqrt(sa * sb || 1);
  }
  function estimateKey(chroma) {
    const total = new Float64Array(12);
    chroma.forEach((c) => { for (let i = 0; i < 12; i++) total[i] += c[i]; });
    let best = { tonic: 0, mode: 'major', score: -Infinity };
    for (let t = 0; t < 12; t++) {
      const maj = correlation(total, KS_MAJOR, t), min = correlation(total, KS_MINOR, t);
      if (maj > best.score) best = { tonic: t, mode: 'major', score: maj };
      if (min > best.score) best = { tonic: t, mode: 'minor', score: min };
    }
    return best;
  }

  /* ---------- コード推定 ---------- */
  function buildStates(vocabName, harmonic) {
    const states = [];
    for (const q of VOCABULARIES[vocabName]) {
      const iv = QUALITIES[q].iv;
      for (let root = 0; root < 12; root++) {
        const t = new Float64Array(12);
        iv.forEach((i, idx) => {
          const w = idx === 3 ? 0.85 : 1;
          const pc = mod12(root + i);
          t[pc] += w;
          if (harmonic) { t[mod12(pc + 7)] += 0.2 * w; t[mod12(pc + 4)] += 0.08 * w; }
        });
        const norm = Math.hypot(...t);
        for (let i = 0; i < 12; i++) t[i] /= norm;
        states.push({ root, q, t, tones: new Set(iv.map((i) => mod12(root + i))) });
      }
    }
    return states;
  }

  function isDiatonic(state, key) {
    const major = key.mode === 'minor' ? mod12(key.tonic + 3) : key.tonic;
    const scale = new Set([0, 2, 4, 5, 7, 9, 11].map((i) => mod12(major + i)));
    let inScale = true;
    state.tones.forEach((pc) => { if (!scale.has(pc)) inScale = false; });
    if (inScale) return true;
    // 短調の V / V7(和声的短音階)
    if (key.mode === 'minor' && state.root === mod12(key.tonic + 7) && (state.q === 'maj' || state.q === '7')) return true;
    return false;
  }

  function emissionMatrix(features, states, key) {
    const n = features.beats.length;
    const med = median(features.energy) || 1;
    const out = new Array(n);
    const diatonic = states.map((s) => isDiatonic(s, key));
    for (let b = 0; b < n; b++) {
      const c = features.chroma[b], ba = features.bass[b];
      const cn = Math.hypot(...c) || 1;
      const baSum = ba.reduce((x, y) => x + y, 0) || 1;
      const row = new Float64Array(states.length + 1);
      const quiet = features.energy[b] < med * 0.04;
      states.forEach((s, i) => {
        let dot = 0;
        for (let k = 0; k < 12; k++) dot += (s.t[k] * c[k]) / cn;
        let bassScore = 0;
        for (let k = 0; k < 12; k++) {
          if (k === s.root) bassScore += (ba[k] / baSum) * 0.22;
          else if (s.tones.has(k)) bassScore += (ba[k] / baSum) * 0.05;
        }
        row[i] = (quiet ? 0 : dot + bassScore) - QUALITIES[s.q].penalty + (diatonic[i] ? 0.025 : 0);
      });
      row[states.length] = quiet ? 1.2 : -0.5; // N.C. 状態
      out[b] = row;
    }
    return out;
  }

  function viterbi(emission, penaltyAt) {
    const n = emission.length;
    if (!n) return [];
    const S = emission[0].length;
    let prev = new Float64Array(emission[0]);
    const back = new Array(n);
    for (let b = 1; b < n; b++) {
      let bestPrev = 0;
      for (let s = 1; s < S; s++) if (prev[s] > prev[bestPrev]) bestPrev = s;
      const pen = penaltyAt(b);
      const cur = new Float64Array(S), bk = new Int32Array(S);
      for (let s = 0; s < S; s++) {
        const jump = prev[bestPrev] - pen;
        if (prev[s] >= jump) { cur[s] = prev[s] + emission[b][s]; bk[s] = s; } else { cur[s] = jump + emission[b][s]; bk[s] = bestPrev; }
      }
      back[b] = bk;
      prev = cur;
    }
    let s = 0;
    for (let i = 1; i < S; i++) if (prev[i] > prev[s]) s = i;
    const path = new Array(n);
    for (let b = n - 1; b >= 0; b--) { path[b] = s; if (b > 0) s = back[b][s]; }
    return path;
  }

  function estimatePhase(path, onsetAt, beatsPerBar) {
    const scores = new Float64Array(beatsPerBar);
    const maxOnset = Math.max(1e-9, ...onsetAt);
    for (let b = 0; b < path.length; b++) {
      if (b > 0 && path[b] !== path[b - 1]) scores[b % beatsPerBar] += 1;
      scores[b % beatsPerBar] += (0.15 * onsetAt[b]) / maxOnset;
    }
    let best = 0;
    for (let i = 1; i < beatsPerBar; i++) if (scores[i] > scores[best]) best = i;
    return best;
  }

  /** 拍ごとの特徴量からコード列を決める。 */
  function decodeChords(features, options) {
    const opts = Object.assign({ vocabulary: 'standard', beatsPerBar: features.beatsPerBar, switchPenalty: 0.16 }, options);
    const B = opts.beatsPerBar;
    const states = buildStates(opts.vocabulary, features.harmonic);
    const key = estimateKey(features.chroma);
    const emission = emissionMatrix(features, states, key);
    const first = viterbi(emission, () => opts.switchPenalty);
    const phase = features.knownPhase !== null && features.knownPhase !== undefined
      ? features.knownPhase : estimatePhase(first, features.onsetAt, B);
    const midBar = B % 2 === 0 ? B / 2 : -1;
    const path = viterbi(emission, (b) => {
      const pos = (((b - phase) % B) + B) % B;
      if (pos === 0) return opts.switchPenalty * 0.5;
      if (pos === midBar) return opts.switchPenalty * 0.9;
      return opts.switchPenalty * 1.7;
    });
    const beatChords = path.map((i) => (i === states.length ? null : { root: states[i].root, q: states[i].q }));
    return { beatChords, phase, beatsPerBar: B, key: refineMode(key, beatChords) };
  }

  /** 平行調(C と Am など)の取り違えを、実際のコードの出現で直す */
  function refineMode(key, beatChords) {
    const major = key.mode === 'minor' ? mod12(key.tonic + 3) : key.tonic;
    const minor = mod12(major + 9);
    const isMinorish = (c) => c.q === 'min' || c.q === 'm7';
    const isMajorish = (c) => c.q === 'maj' || c.q === 'maj7' || c.q === '7';
    let majScore = 0, minScore = 0;
    const list = beatChords.filter(Boolean);
    for (const c of list) {
      if (c.root === major && isMajorish(c)) majScore += 1;
      if (c.root === minor && isMinorish(c)) minScore += 1;
      if (c.root === mod12(major + 4) && isMajorish(c)) minScore += 1.5; // 短調の V(Am に対する E)
    }
    const bonus = list.length * 0.1;
    if (list.length) {
      for (const c of [list[0], list[list.length - 1]]) {
        if (c.root === major && isMajorish(c)) majScore += bonus;
        if (c.root === minor && isMinorish(c)) minScore += bonus;
      }
    }
    return minScore > majScore ? { tonic: minor, mode: 'minor' } : { tonic: major, mode: 'major' };
  }

  /** 拍の列を小節に分ける。セグメントは同じコードが続く区間。 */
  function buildBars(beatChords, phase, B) {
    const n = beatChords.length;
    const firstStart = phase % B === 0 ? 0 : (phase % B) - B;
    const bars = [];
    for (let s = firstStart; s < n; s += B) {
      const segments = [];
      let any = false;
      for (let i = 0; i < B; i++) {
        const idx = s + i;
        const chord = idx >= 0 && idx < n ? beatChords[idx] : null;
        if (chord) any = true;
        const lastSeg = segments[segments.length - 1];
        if (lastSeg && sameChord(lastSeg.chord, chord)) lastSeg.len++;
        else segments.push({ chord, beat: i, len: 1, beatIndex: idx });
      }
      bars.push({ start: s, segments, any });
    }
    while (bars.length && !bars[0].any) bars.shift();
    while (bars.length && !bars[bars.length - 1].any) bars.pop();
    bars.forEach((b, i) => { b.number = i + 1; });
    return bars;
  }

  /** 表示用に移調・カポを反映した和音 */
  function shiftChord(chord, semis) {
    return chord ? { root: mod12(chord.root + semis), q: chord.q } : null;
  }

  /* ---------- テキスト出力 ---------- */
  function renderChordText(bars, opts) {
    const shift = opts.transpose - opts.capo, perLine = opts.barsPerLine || 4;
    const lines = [];
    for (let i = 0; i < bars.length; i += perLine) {
      let line = '|';
      for (const bar of bars.slice(i, i + perLine)) {
        const parts = bar.segments.map((s) => chordName(shiftChord(s.chord, shift), opts.flats));
        line += ' ' + parts.join(' ').padEnd(16) + ' |';
      }
      lines.push(line);
    }
    return lines.join('\n');
  }

  function renderTabText(bars, opts) {
    const shift = opts.transpose - opts.capo, perLine = opts.barsPerLine || 4, cell = 5;
    const labels = ['e', 'B', 'G', 'D', 'A', 'E']; // 上から 1弦→6弦
    const blocks = [];
    for (let i = 0; i < bars.length; i += perLine) {
      let head = '  ';
      const rows = labels.map((l) => l + '|');
      for (const bar of bars.slice(i, i + perLine)) {
        const width = bar.segments.reduce((a, s) => a + s.len, 0) * cell;
        const startCol = rows[0].length;
        for (const seg of bar.segments) {
          const col = startCol + seg.beat * cell + 1;
          if (seg.chord) {
            const shown = shiftChord(seg.chord, shift);
            const name = chordName(shown, opts.flats);
            head = head.length < col ? head.padEnd(col) : head + ' ';
            head += name;
          }
        }
        for (let r = 0; r < 6; r++) {
          let body = '-'.repeat(width).split('');
          for (const seg of bar.segments) {
            if (!seg.chord) continue;
            const v = getVoicing(seg.chord.root + shift, seg.chord.q, opts.easy);
            const f = v.frets[5 - r];
            const s = f === null ? 'x' : String(f);
            for (let c = 0; c < s.length; c++) body[seg.beat * cell + 1 + c] = s[c];
          }
          rows[r] += body.join('') + '|';
        }
      }
      blocks.push([head.trimEnd(), ...rows].join('\n'));
    }
    return blocks.join('\n\n');
  }

  /** コードダイアグラム(SVG 文字列) */
  function diagramSVG(chord, flats, opts) {
    opts = opts || {};
    const v = getVoicing(chord.root, chord.q, opts.easy);
    const fretted = v.frets.filter((f) => f !== null && f > 0);
    const maxF = fretted.length ? Math.max(...fretted) : 0, minF = fretted.length ? Math.min(...fretted) : 0;
    const base = maxF <= 4 ? 1 : minF;
    if (opts.horizontal) return horizontalDiagram(chord, flats, v, fretted, base);
    const x = (s) => 18 + s * 14, y = (f) => 22 + f * 18;
    let out = `<svg class="diagram" viewBox="0 0 110 118" role="img" aria-label="${chordName(chord, flats)} のフォーム ${v.frets.map((f) => (f === null ? 'x' : f)).join(' ')}">`;
    for (let s = 0; s < 6; s++) out += `<line x1="${x(s)}" y1="${y(0)}" x2="${x(s)}" y2="${y(4)}" class="d-line"/>`;
    for (let f = 0; f <= 4; f++) out += `<line x1="${x(0)}" y1="${y(f)}" x2="${x(5)}" y2="${y(f)}" class="${f === 0 && base === 1 ? 'd-nut' : 'd-line'}"/>`;
    if (base > 1) out += `<text x="${x(5) + 7}" y="${y(1) - 4}" class="d-base">${base}f</text>`;
    if (v.barre && fretted.includes(v.barre)) {
      const idx = v.frets.map((f, i) => (f === v.barre ? i : -1)).filter((i) => i >= 0);
      const a = idx[0], z = idx[idx.length - 1];
      if (z > a + 1) {
        const yy = y(v.barre - base + 1) - 9;
        out += `<line x1="${x(a)}" y1="${yy}" x2="${x(z)}" y2="${yy}" class="d-barre"/>`;
      }
    }
    v.frets.forEach((f, s) => {
      if (f === null) out += `<text x="${x(s)}" y="${y(0) - 6}" class="d-mark">×</text>`;
      else if (f === 0) out += `<circle cx="${x(s)}" cy="${y(0) - 10}" r="3.6" class="d-open"/>`;
      else out += `<circle cx="${x(s)}" cy="${y(f - base + 1) - 9}" r="5.4" class="d-dot"/>`;
    });
    return out + '</svg>';
  }

  /** 歌詞の行間に置く横向きの図。上が 1 弦、下が 6 弦、左がナット側。 */
  function horizontalDiagram(chord, flats, v, fretted, base) {
    const x = (f) => 15 + f * 15, y = (s) => 7 + (5 - s) * 8.4; // s: 0=6弦 .. 5=1弦
    let out = `<svg class="diagram-h" viewBox="0 0 80 58" role="img" aria-label="${chordName(chord, flats)} のフォーム ${v.frets.map((f) => (f === null ? 'x' : f)).join(' ')}">`;
    for (let s = 0; s < 6; s++) out += `<line x1="${x(0)}" y1="${y(s)}" x2="${x(4)}" y2="${y(s)}" class="d-line"/>`;
    for (let f = 0; f <= 4; f++) out += `<line x1="${x(f)}" y1="${y(5)}" x2="${x(f)}" y2="${y(0)}" class="${f === 0 && base === 1 ? 'd-nut' : 'd-line'}"/>`;
    if (base > 1) out += `<text x="${x(0)}" y="57" class="d-base">${base}f</text>`;
    if (v.barre && fretted.includes(v.barre)) {
      const idx = v.frets.map((f, i) => (f === v.barre ? i : -1)).filter((i) => i >= 0);
      if (idx[idx.length - 1] > idx[0] + 1) {
        const xx = x(v.barre - base + 1) - 7.5;
        out += `<line x1="${xx}" y1="${y(idx[0])}" x2="${xx}" y2="${y(idx[idx.length - 1])}" class="d-barre-h"/>`;
      }
    }
    v.frets.forEach((f, s) => {
      if (f === null) out += `<text x="6.5" y="${y(s) + 3.8}" class="d-mark-h">×</text>`;
      else if (f === 0) out += `<circle cx="7" cy="${y(s)}" r="2.6" class="d-open"/>`;
      else out += `<circle cx="${x(f - base + 1) - 7.5}" cy="${y(s)}" r="3.7" class="d-dot"/>`;
    });
    return out + '</svg>';
  }

  /* ---------- 難易度 ---------- */
  const EASY_MAP = { '7': 'maj', maj7: 'maj', m7: 'min', sus4: 'maj', dim: 'min', aug: 'maj', m7b5: 'min' };
  const MID_MAP = { aug: 'maj', m7b5: 'm7' };
  function simplifyChord(chord, level) {
    if (!chord) return null;
    const map = level === 'easy' ? EASY_MAP : level === 'mid' ? MID_MAP : {};
    return map[chord.q] ? { root: chord.root, q: map[chord.q] } : chord;
  }
  /** 難易度に合わせてコード列を整える。初級では 1 拍だけのコードを前のコードにまとめる。 */
  function applyDifficulty(beatChords, level) {
    const out = beatChords.map((c) => simplifyChord(c, level));
    if (level === 'easy') {
      let i = 0;
      while (i < out.length) {
        let j = i + 1;
        while (j < out.length && sameChord(out[j], out[i])) j++;
        if (j - i === 1 && i > 0 && out[i] && out[i - 1]) out[i] = out[i - 1];
        i = j;
      }
    }
    return out;
  }

  /* ---------- 歌詞 ---------- */
  /** 貼り付けられた歌詞を行に分ける。LRC の [mm:ss.xx] があれば時刻として読む。 */
  function parseLyrics(text) {
    const lines = [];
    for (const raw of String(text).split(/\r?\n/)) {
      let line = raw.trim(), time = null;
      if (/^\[[a-z]+:.*\]$/i.test(line)) continue; // LRC のメタ情報 [ar:...] など
      const m = line.match(/^\[(\d+):(\d+(?:\.\d+)?)\]/);
      if (m) { time = Number(m[1]) * 60 + Number(m[2]); line = line.slice(m[0].length).trim(); }
      if (!line) lines.push({ kind: 'blank' });
      else if (time === null && /^(\[.*\]|【.*】|<.*>|＜.*＞)$/.test(line)) lines.push({ kind: 'section', text: line.replace(/^[\[【<＜]|[\]】>＞]$/g, '') });
      else lines.push({ kind: 'lyric', text: line, time });
    }
    while (lines.length && lines[lines.length - 1].kind === 'blank') lines.pop();
    while (lines.length && lines[0].kind === 'blank') lines.shift();
    return lines;
  }

  function beatAtTime(beats, t) {
    let lo = 0, hi = beats.length - 1;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (beats[m] <= t + 0.12) lo = m; else hi = m - 1; }
    return lo;
  }

  /** 時刻のない行を、文字数に応じて時刻のある行の間へ割り振る */
  function resolveLineTimes(lyricLines, beatChords, beats, duration) {
    const n = beatChords.length;
    let first = 0, last = n - 1;
    while (first < n && !beatChords[first]) first++;
    while (last > 0 && !beatChords[last]) last--;
    const songStart = first < n ? beats[first] : 0;
    const songEnd = last + 1 < n ? beats[last + 1] : duration;
    const times = lyricLines.map((l) => (typeof l.time === 'number' ? l.time : null));
    const weight = (i) => Array.from(lyricLines[i].text).length + 2;
    let i = 0;
    while (i < times.length) {
      if (times[i] !== null) { i++; continue; }
      let j = i;
      while (j < times.length && times[j] === null) j++;
      const from = i > 0 ? times[i - 1] : songStart;
      const to = j < times.length ? times[j] : songEnd;
      let total = 0;
      for (let k = i - (i > 0 ? 1 : 0); k < j; k++) total += weight(k);
      let acc = i > 0 ? weight(i - 1) : 0;
      for (let k = i; k < j; k++) { times[k] = from + ((to - from) * acc) / (total || 1); acc += weight(k); }
      i = j;
    }
    return times;
  }

  function chordRuns(beatChords, b0, b1) {
    const runs = [];
    for (let b = b0; b < b1; b++) {
      const last = runs[runs.length - 1];
      if (last && sameChord(last.chord, beatChords[b])) last.end = b + 1;
      else runs.push({ chord: beatChords[b], start: b, end: b + 1 });
    }
    return runs;
  }

  /** 歌詞のない区間を 4 小節ごとの行にする */
  function chordOnlyRows(beatChords, b0, b1, phase, B) {
    const rows = [];
    let s = b0;
    while (s < b1) {
      const group = Math.floor((s - phase) / (4 * B));
      let e = s + 1;
      while (e < b1 && Math.floor((e - phase) / (4 * B)) === group) e++;
      const cells = chordRuns(beatChords, s, e).filter((r) => r.chord)
        .map((r) => ({ chord: r.chord, start: r.start, end: r.end, text: '' }));
      if (cells.length) rows.push({ type: 'chords', cells });
      s = e;
    }
    return rows;
  }

  /**
   * 歌詞の行とコードを組み合わせて譜面の行を作る。
   * 各セルは「コード+その下に歌う文字」。文字の割り当ては時刻からの比例配分なので、
   * charShift(beatIndex → ずらす文字数)で手直しできる。
   */
  function buildLyricLayout(o) {
    const { beatChords, beats, lines, duration, phase, beatsPerBar: B } = o;
    const charShift = o.charShift || new Map();
    const n = beatChords.length;
    const lyricLines = lines.filter((l) => l.kind === 'lyric');
    if (!lyricLines.length) return chordOnlyRows(beatChords, 0, n, phase, B);
    const times = resolveLineTimes(lyricLines, beatChords, beats, duration);
    const rows = [];
    let pending = [], k = 0;
    lines.forEach((line) => {
      if (line.kind === 'blank') { pending.push({ type: 'gap' }); return; }
      if (line.kind === 'section') { pending.push({ type: 'section', text: line.text }); return; }
      const t = times[k];
      const bStart = beatAtTime(beats, t);
      const bEnd = k + 1 < times.length ? Math.max(bStart + 1, beatAtTime(beats, times[k + 1])) : n;
      if (k === 0) rows.push(...chordOnlyRows(beatChords, 0, bStart, phase, B));
      rows.push(...pending);
      pending = [];

      const chars = Array.from(line.text);
      const nextTime = k + 1 < times.length ? times[k + 1] : duration;
      const sungEnd = t + Math.min(Math.max(0.5, nextTime - t), Math.max(1.5, chars.length * 0.6));
      let runs = chordRuns(beatChords, bStart, Math.min(bEnd, n));
      // 行の頭の直後でコードが変わるなら、タップの揺れとみなして頭のコードを落とす
      if (runs.length > 1 && runs[0].end - runs[0].start <= 1) runs = runs.slice(1);
      const sungRuns = [], afterRuns = [];
      runs.forEach((r, i) => { (i === 0 || beats[r.start] < sungEnd ? sungRuns : afterRuns).push(r); });
      // 短い間奏はそのまま同じ行に。2 小節以上あれば別の行に分ける
      const afterBeats = afterRuns.reduce((a, r) => a + r.end - r.start, 0);
      const splitAfter = afterBeats >= 2 * B;
      const cellRuns = splitAfter ? sungRuns : runs;
      const inSung = (r, i) => i === 0 || beats[r.start] < sungEnd;
      let prev = 0;
      const idx = cellRuns.map((r, i) => {
        if (i === 0) return 0;
        const frac = inSung(r, i) ? (beats[r.start] - t) / Math.max(0.1, sungEnd - t) : 1;
        const pos = Math.round(frac * chars.length) + (charShift.get(r.start) || 0);
        prev = Math.max(prev, Math.min(chars.length, pos));
        return prev;
      });
      const cells = cellRuns.map((r, i) => ({
        chord: r.chord, start: r.start, end: r.end, shiftable: i > 0,
        text: chars.slice(idx[i], i + 1 < idx.length ? idx[i + 1] : chars.length).join(''),
      }));
      rows.push({ type: 'lyric', lineIndex: k, time: t, cells });
      if (splitAfter && afterRuns.length) rows.push(...chordOnlyRows(beatChords, afterRuns[0].start, Math.min(bEnd, n), phase, B));
      k++;
    });
    rows.push(...pending.filter((p) => p.type === 'section'));
    return rows;
  }

  /* ---------- 音の合成(MIDI の試聴・デモ・テストで使う) ---------- */
  function renderNotes(notes, sr, duration, options) {
    const out = new Float32Array(Math.ceil(duration * sr));
    const detune = (options && options.detuneCents) || 0;
    const partials = [1, 0.55, 0.35, 0.2, 0.12];
    for (const n of notes) {
      const f0 = 440 * Math.pow(2, (n.pitch - 69 + detune / 100) / 12);
      const a0 = 0.16 * (n.vel === undefined ? 0.8 : n.vel / 127);
      const st = Math.floor(n.start * sr), en = Math.min(out.length, Math.floor((n.end + 0.05) * sr));
      const noteLen = n.end - n.start;
      partials.forEach((amp, h) => {
        const f = f0 * (h + 1);
        if (f > sr / 2.2) return;
        const w = (2 * Math.PI * f) / sr, decay = 1.6 + h * 0.8;
        for (let i = st; i < en; i++) {
          const t = (i - st) / sr;
          const attack = Math.min(1, t / 0.006);
          const release = t > noteLen ? Math.max(0, 1 - (t - noteLen) / 0.05) : 1;
          out[i] += a0 * amp * attack * release * Math.exp(-t * decay) * Math.sin(w * (i - st));
        }
      });
    }
    return out;
  }

  function addDrums(out, sr, bpm, startSec, endSec, rng) {
    const beat = 60 / bpm;
    const random = rng || Math.random;
    const hit = (time, len, amp, lowHz) => {
      const st = Math.floor(time * sr);
      let lp = 0;
      for (let i = 0; i < len * sr && st + i < out.length; i++) {
        const t = i / sr, env = Math.exp(-t / (len / 5));
        const noise = random() * 2 - 1;
        if (lowHz) { lp = Math.sin((2 * Math.PI * lowHz * t) * (1 - t * 1.5)); out[st + i] += amp * env * lp; } else out[st + i] += amp * env * noise;
      }
    };
    let i = 0;
    for (let t = startSec; t < endSec; t += beat, i++) {
      if (i % 2 === 0) hit(t, 0.14, 0.5, 60); else hit(t, 0.12, 0.3, 0);
      hit(t, 0.03, 0.09, 0);
      hit(t + beat / 2, 0.03, 0.06, 0);
    }
  }

  function chordToNotes(root, q, start, end, octaveBase) {
    const iv = QUALITIES[q].iv;
    return iv.map((i) => ({ pitch: (octaveBase || 48) + root + i, start, end, vel: 90 }));
  }

  /** 伴奏(コード+ベース+メロディ+ドラム)を合成する。テストの正解データも返す。 */
  function synthSong(options) {
    const o = Object.assign({ bpm: 100, sr: 11025, progression: [[0, 'maj'], [7, 'maj'], [9, 'min'], [5, 'maj']], repeats: 6, detuneCents: 0, drums: true, melody: true, leadIn: 0.4, seed: 7, beatsPerChord: 4, arpeggio: false, noise: 0 }, options);
    let s = o.seed;
    const rng = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    const beat = 60 / o.bpm;
    const notes = [], truth = [];
    let t = o.leadIn;
    for (let r = 0; r < o.repeats; r++) {
      for (const [root, q] of o.progression) {
        truth.push({ start: t, end: t + o.beatsPerChord * beat, root, q });
        for (let b = 0; b < o.beatsPerChord; b++) {
          const at = t + b * beat;
          if (o.arpeggio) {
            const iv = QUALITIES[q].iv;
            for (let k = 0; k < 2; k++) {
              const pitch = 48 + root + iv[(b * 2 + k) % iv.length];
              notes.push({ pitch, start: at + (k * beat) / 2, end: at + beat * 1.5, vel: 85 });
            }
          } else {
            notes.push(...chordToNotes(root, q, at, at + beat * 0.95));
          }
          notes.push({ pitch: 36 + root, start: at, end: at + beat * 0.9, vel: 110 });
          if (o.melody) {
            const iv = QUALITIES[q].iv;
            const tone = iv[Math.floor(rng() * iv.length)];
            notes.push({ pitch: 72 + mod12(root + tone), start: at, end: at + beat * 0.45, vel: 80 });
            if (rng() < 0.5) { // 経過音
              const scale = [0, 2, 4, 5, 7, 9, 11];
              notes.push({ pitch: 72 + scale[Math.floor(rng() * 7)], start: at + beat / 2, end: at + beat * 0.9, vel: 60 });
            }
          }
        }
        t += o.beatsPerChord * beat;
      }
    }
    const duration = t + 0.8;
    const samples = renderNotes(notes, o.sr, duration, { detuneCents: o.detuneCents });
    if (o.drums) addDrums(samples, o.sr, o.bpm, o.leadIn, t, rng);
    if (o.noise) for (let i = 0; i < samples.length; i++) samples[i] += o.noise * (rng() * 2 - 1);
    let peak = 0;
    for (const v of samples) peak = Math.max(peak, Math.abs(v));
    if (peak > 0.95) for (let i = 0; i < samples.length; i++) samples[i] *= 0.95 / peak;
    return { samples, sr: o.sr, truth, notes, duration };
  }

  function encodeWav(samples, sr) {
    const buf = new ArrayBuffer(44 + samples.length * 2);
    const d = new DataView(buf);
    const str = (p, s) => { for (let i = 0; i < s.length; i++) d.setUint8(p + i, s.charCodeAt(i)); };
    str(0, 'RIFF'); d.setUint32(4, 36 + samples.length * 2, true); str(8, 'WAVEfmt ');
    d.setUint32(16, 16, true); d.setUint16(20, 1, true); d.setUint16(22, 1, true);
    d.setUint32(24, sr, true); d.setUint32(28, sr * 2, true); d.setUint16(32, 2, true); d.setUint16(34, 16, true);
    str(36, 'data'); d.setUint32(40, samples.length * 2, true);
    for (let i = 0; i < samples.length; i++) d.setInt16(44 + i * 2, Math.max(-1, Math.min(1, samples[i])) * 32767, true);
    return buf;
  }

  root.ChordTab = {
    QUALITIES, VOCABULARIES, SHARP, FLAT, mod12, usesFlats, noteName, chordName, sameChord,
    getVoicing, voicingPitchClasses, recommendCapo, extractAudioFeatures, parseMidi, extractMidiFeatures,
    decodeChords, buildBars, shiftChord, renderChordText, renderTabText, diagramSVG,
    renderNotes, synthSong, encodeWav, median, simplifyChord, applyDifficulty, parseLyrics, resolveLineTimes, buildLyricLayout,
  };
})(typeof window !== 'undefined' ? window : globalThis);
