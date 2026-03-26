// netlify/functions/seismic.js
// Proxy + decoder complet Steim-2 — returneaza JSON cu samples

export async function handler(event) {
  const { net, sta, loc, cha, start, end } = event.queryStringParameters || {};

  if (!sta || !start || !end) {
    return json400({ error: 'Parametri lipsă: sta, start, end' });
  }

  const url =
    `https://data.raspberryshake.org/fdsnws/dataselect/1/query` +
    `?net=${net || 'AM'}&sta=${sta}&loc=${loc || '00'}&cha=${cha || 'EHZ'}` +
    `&start=${start}&end=${end}`;

  let resp;
  try {
    resp = await fetch(url, { headers: { 'User-Agent': 'SeismicWatch/1.0' } });
  } catch (err) {
    return json500({ error: 'Network error: ' + err.message });
  }

  if (!resp.ok) {
    return {
      statusCode: resp.status,
      headers: corsHeaders(),
      body: JSON.stringify({ error: `FDSN ${resp.status}: ${resp.statusText}` }),
    };
  }

  const buf = Buffer.from(await resp.arrayBuffer());

  let samples, sampleRate, startTime;
  try {
    ({ samples, sampleRate, startTime } = decodeMiniSEED(buf));
  } catch (err) {
    return json500({ error: 'Decode error: ' + err.message });
  }

  if (!samples.length) {
    return json500({ error: 'No samples decoded' });
  }

  // ── Detrend
  const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
  const detrended = samples.map(s => s - mean);

  // ── Filtru Butterworth bandpass 0.5–4 Hz (zona cutremure)
  const filtered = butterworthBandpass(detrended, sampleRate, 0.5, 4.0, 4);

  // ── Clasificare sursa (raw vs filtered)
  const classification = classifySource(detrended, filtered, sampleRate);

  return {
    statusCode: 200,
    headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      samples: detrended,          // semnal original detrended
      filtered,                    // semnal filtrat 0.5-4 Hz
      sampleRate,
      startTime,
      count: detrended.length,
      classification,              // analiza sursa
    }),
  };
}

// ════════════════════════════════════════════════════════════
//  FILTRU BUTTERWORTH BANDPASS  (IIR bidirecțional, 0-phase)
//  Implementare: cascada de filtre biquad de ordinul 2
// ════════════════════════════════════════════════════════════
function butterworthBandpass(signal, fs, fLow, fHigh, order = 4) {
  // Transformam in perechi de filtre low-pass + high-pass
  // folosind aproximarea bilineara
  const sections = designButterworthBP(fs, fLow, fHigh, order);

  // Aplicam forward + backward (zero-phase)
  let y = applyBiquadCascade(signal, sections);
  y.reverse();
  y = applyBiquadCascade(y, sections);
  y.reverse();
  return y;
}

function designButterworthBP(fs, fLow, fHigh, order) {
  // Pre-warp frecventele
  const nyq  = fs / 2;
  const wLow  = Math.tan(Math.PI * fLow  / fs);
  const wHigh = Math.tan(Math.PI * fHigh / fs);
  const bw    = wHigh - wLow;
  const w0sq  = wLow * wHigh;

  const sections = [];
  const nPairs = Math.floor(order / 2);

  for (let k = 1; k <= nPairs; k++) {
    // Pol analog Butterworth
    const theta = Math.PI * (2 * k - 1) / (2 * order);
    const sinT  = Math.sin(theta);
    const cosT  = Math.cos(theta);

    // Transformare LP→BP in domeniu analogic
    // Fiecare pol LP devine 2 poli BP
    // Folosim aproximare directa pentru sectie biquad digitala

    // LP prototip: pol la -sinT + j*cosT
    // Transformare BP: s_lp = (s^2 + w0sq) / (bw*s)
    // Rezolvam pentru polii BP

    const alpha = bw * sinT / 2;
    const beta  = Math.sqrt(w0sq + (bw * sinT / 2) ** 2);

    // Coeficienti biquad bandpass
    const a0 =  1 + alpha;
    const a1 = -2 * Math.cos(2 * Math.PI * Math.sqrt(w0sq) / (2 * Math.PI)) ;
    const a2 =  1 - alpha;

    // Versiune simplificata stabila:
    const Wn   = 2 * Math.atan(Math.sqrt(w0sq)) / Math.PI * (fs / 2);
    const Q    = Math.sqrt(w0sq) / bw;
    const w0d  = 2 * Math.PI * Math.sqrt(fLow * fHigh) / fs; // in radiani/sample
    const alph = Math.sin(w0d) / (2 * Q);

    sections.push({
      b0:  alph,
      b1:  0,
      b2: -alph,
      a0:  1 + alph,
      a1: -2 * Math.cos(w0d),
      a2:  1 - alph,
    });
  }

  // Daca order e impar, adaugam o sectie de ordinul 1 suplimentara
  if (order % 2 !== 0) {
    const wc = Math.tan(Math.PI * Math.sqrt(fLow * fHigh) / fs);
    sections.push({ b0: wc, b1: 0, b2: 0, a0: 1 + wc, a1: -(1 - wc), a2: 0 });
  }

  return sections;
}

function applyBiquadCascade(signal, sections) {
  let y = Float64Array.from(signal);
  for (const s of sections) {
    const { b0, b1, b2, a0, a1, a2 } = s;
    const B0 = b0 / a0, B1 = b1 / a0, B2 = b2 / a0;
    const A1 = a1 / a0, A2 = a2 / a0;
    const out = new Float64Array(y.length);
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < y.length; i++) {
      const x0 = y[i];
      const y0  = B0 * x0 + B1 * x1 + B2 * x2 - A1 * y1 - A2 * y2;
      out[i] = y0;
      x2 = x1; x1 = x0;
      y2 = y1; y1 = y0;
    }
    y = out;
  }
  return Array.from(y);
}

// ════════════════════════════════════════════════════════════
//  CLASIFICARE SURSĂ — diferentiaza cutremur de trafic/zgomot
// ════════════════════════════════════════════════════════════
function classifySource(raw, filtered, fs) {
  const n = raw.length;
  if (n === 0) return { type: 'unknown', confidence: 0, details: {} };

  // ══════════════════════════════════════════════════
  //  CRITERIU 1 — Distributie spectrala (FFT)
  //  Cutremur: energie concentrata in 0.5-4.5 Hz
  //  Camion/trafic: energie la 5-20 Hz, impuls rapid
  // ══════════════════════════════════════════════════
  const fftSize = nextPow2(Math.min(n, 8192));
  const re = new Float64Array(fftSize);
  const im = new Float64Array(fftSize);
  // Hann window pentru reducerea scurgerilor spectrale
  for (let i = 0; i < fftSize; i++) {
    const w = 0.5 * (1 - Math.cos(2 * Math.PI * i / (fftSize - 1)));
    re[i] = (raw[n - fftSize + i] || 0) * w;
  }
  fftInPlace(re, im);

  let pSeismic = 0, pTraffic = 0, pIndustrial = 0, pTotal = 0;
  let pInfrasonic = 0, pAllTotal = 0;
  for (let i = 1; i < fftSize / 2; i++) {
    const f   = i * fs / fftSize;
    const mag = re[i] * re[i] + im[i] * im[i];
    if (f >= 0.5 && f <= 4.5)  pSeismic    += mag;
    if (f > 4.5  && f <= 15)   pTraffic    += mag;
    if (f > 15   && f <= 45)   pIndustrial += mag;
    if (f >= 0.5 && f <= 45)   pTotal      += mag;
    if (f < 0.5)               pInfrasonic += mag;
    pAllTotal += mag;
  }
  pTotal    = pTotal    || 1;
  pAllTotal = pAllTotal || 1;
  const ratioSeismic    = pSeismic    / pTotal;
  const ratioTraffic    = pTraffic    / pTotal;
  const ratioIndustrial = pIndustrial / pTotal;
  // Raport infrason: cat % din energie totala (0..Nyquist) este sub 0.5 Hz
  // Deriva senzor / tilt / suprasarcina ADC → energie masiva sub 0.5 Hz
  const ratioInfrasonic = pInfrasonic / pAllTotal;

  // ══════════════════════════════════════════════════
  //  CRITERIU 2 — Forma de unda: rise time + coda
  //
  //  Cutremur tipic:
  //    - Rise time (10%→90% din varf): 3-20 secunde
  //    - Durata totala: 15-90+ secunde
  //    - Coda (descrestere lenta dupa varf): codaRatio > 1.5
  //    - Simetrie envelope: asimetric (coda > rise)
  //
  //  Camion/TIR la 6m:
  //    - Rise time: 0.3-1.5 secunde (intra rapid in camp)
  //    - Durata: 2-6 secunde
  //    - Coda: aproape simetric (trece si dispare)
  //    - codaRatio: ~0.8-1.2 (simetric)
  // ══════════════════════════════════════════════════
  const env    = computeEnvelope(raw, fs);
  const peakV  = Math.max(...env);
  const peakI  = env.indexOf(peakV);

  // Rise time: de la 10% la 90% din varf
  let iRise10 = 0, iRise90 = peakI;
  for (let i = 0; i < peakI; i++) {
    if (env[i] > peakV * 0.10 && iRise10 === 0) iRise10 = i;
    if (env[i] > peakV * 0.90) { iRise90 = i; break; }
  }
  const riseTimeSec = Math.max(0, (iRise90 - iRise10)) / fs;

  // Durata eveniment (timp cat envelope > 10% din varf)
  let evSamples = 0;
  for (const v of env) if (v > peakV * 0.10) evSamples++;
  const eventDuration = evSamples / fs;

  // Coda ratio: energie dupa varf / energie inainte de varf
  // Un cutremur are coda lunga => postPeak >> prePeak
  let prePeak = 0, postPeak = 0;
  for (let i = 0;       i < peakI;    i++) prePeak  += env[i] * env[i];
  for (let i = peakI+1; i < env.length; i++) postPeak += env[i] * env[i];
  const codaRatio = prePeak > 0 ? postPeak / prePeak : 1;

  // Asimetrie: pentru cutremur postPeak >> prePeak
  // pentru camion: postPeak ≈ prePeak (simetric)
  const asymmetry = postPeak / (prePeak + postPeak + 1e-10);
  // asymmetry > 0.6 = coada lunga (cutremur), < 0.5 = simetric (trafic)

  // ══════════════════════════════════════════════════
  //  CRITERIU 3 — STA/LTA si caracterul impulsiv
  //
  //  Trafic greu: STA/LTA foarte mare (>15) dar SCURT (<3s trigger)
  //  Cutremur: STA/LTA moderat (3-15) dar LUNG (>8s trigger)
  // ══════════════════════════════════════════════════
  const staLta = computeSTALTA(raw, fs);
  // Raport impulsivitate: peak instantaneu / RMS total
  const rms = Math.sqrt(raw.reduce((a, b) => a + b * b, 0) / n);
  const impulsivity = peakV / (rms + 1e-10);
  // Camion: impulsivity > 15 (spike izolat)
  // Cutremur: impulsivity 4-12 (mai gradual)

  // ══════════════════════════════════════════════════
  //  CRITERIU 4 — Spectru sustinut vs spike
  //
  //  Impartim fereastra in segmente de 5s si calculam
  //  cat de stabil e spectrul in timp (cutremur = stabil,
  //  trafic = spike in primul segment, apoi zgomot)
  // ══════════════════════════════════════════════════
  const segSamples = Math.round(fs * 5);
  const nSegs = Math.floor(n / segSamples);
  let seismicInSeg = 0;
  for (let s = 0; s < Math.min(nSegs, 6); s++) {
    const seg = raw.slice(s * segSamples, (s + 1) * segSamples);
    const segRms = Math.sqrt(seg.reduce((a, b) => a + b * b, 0) / seg.length);
    const segPeak = Math.max(...seg.map(Math.abs));
    // Daca exista semnal consistent in mai multe segmente => cutremur
    if (segRms > rms * 0.3) seismicInSeg++;
  }
  const spectralPersistence = nSegs > 0 ? seismicInSeg / Math.min(nSegs, 6) : 0;
  // cutremur: persistence > 0.5 (semnal in multiple segmente)
  // trafic:   persistence < 0.25 (semnal doar in 1-2 segmente)

  // ══════════════════════════════════════════════════
  //  SCOR FINAL — sistem ponderat cu veto
  // ══════════════════════════════════════════════════
  let score = 0;
  const flags = [];  // motive

  // --- Spectru frecvente ---
  if (ratioSeismic > 0.55)    { score += 3; flags.push('spectru seismic dominant'); }
  else if (ratioSeismic > 0.35) { score += 1; flags.push('spectru partial seismic'); }
  if (ratioTraffic > 0.45)    { score -= 3; flags.push('energie trafic ridicata'); }
  if (ratioIndustrial > 0.35) { score -= 2; flags.push('zgomot industrial'); }

  // --- Rise time (criteriu PUTERNIC anti-trafic) ---
  if (riseTimeSec > 5)        { score += 3; flags.push(`rise time lung (${riseTimeSec.toFixed(1)}s)`); }
  else if (riseTimeSec > 2)   { score += 1; flags.push(`rise time mediu (${riseTimeSec.toFixed(1)}s)`); }
  else if (riseTimeSec < 0.8) { score -= 4; flags.push(`rise time SCURT (${riseTimeSec.toFixed(2)}s) — probabil trafic`); }
  else if (riseTimeSec < 1.5) { score -= 2; flags.push(`rise time suspect (${riseTimeSec.toFixed(1)}s)`); }

  // --- Durata eveniment ---
  if (eventDuration > 20)     { score += 3; flags.push(`durata lunga (${eventDuration.toFixed(0)}s)`); }
  else if (eventDuration > 8) { score += 1; flags.push(`durata medie (${eventDuration.toFixed(0)}s)`); }
  else if (eventDuration < 4) { score -= 4; flags.push(`durata SCURTA (${eventDuration.toFixed(1)}s) — probabil trafic`); }
  else if (eventDuration < 6) { score -= 2; flags.push(`durata redusa (${eventDuration.toFixed(1)}s)`); }

  // --- Coda (coada seismica) ---
  if (codaRatio > 2.5)        { score += 3; flags.push('coda seismica pronuntata'); }
  else if (codaRatio > 1.5)   { score += 1; flags.push('coda moderata'); }
  else if (codaRatio < 0.9)   { score -= 2; flags.push('fara coda (simetric)'); }

  // --- Impulsivitate ---
  if (impulsivity > 20)       { score -= 3; flags.push(`impuls izolat (x${impulsivity.toFixed(0)} RMS) — trafic`); }
  else if (impulsivity > 12)  { score -= 1; flags.push('partial impulsiv'); }
  else if (impulsivity < 6)   { score += 1; flags.push('semnal gradual'); }

  // --- Persistenta spectrala in timp ---
  if (spectralPersistence > 0.6)  { score += 2; flags.push('semnal persistent in timp'); }
  else if (spectralPersistence < 0.25) { score -= 2; flags.push('semnal izolat (1-2 segmente)'); }

  // --- STA/LTA ---
  if (staLta.maxRatio > 12 && staLta.triggerDuration < 2) {
    score -= 3; flags.push('trigger STA/LTA scurt si puternic');
  } else if (staLta.maxRatio > 4 && staLta.triggerDuration > 8) {
    score += 2; flags.push('trigger STA/LTA sustinut');
  }

  // --- Infrason / deriva senzor (< 0.5 Hz) ---
  // Cutremurele locale NU au frecventa dominanta sub 0.5 Hz.
  // Deriva termica, tilt senzor, suprasarcina ADC → energie masiva sub 0.5 Hz
  if (ratioInfrasonic > 0.60) {
    score -= 6; flags.push(`infrason dominant (${(ratioInfrasonic*100).toFixed(0)}% energie sub 0.5Hz) — deriva senzor/ADC`);
  } else if (ratioInfrasonic > 0.30) {
    score -= 3; flags.push('energie infrasonica ridicata — posibil zgomot de fond');
  }

  // --- Saturare / overflow ADC ---
  // Amplitudinea maxima a semnalului nu poate depasi ~int32/2 in conditii normale
  const peakAbsRaw = Math.max(...raw.map(Math.abs));
  if (peakAbsRaw > 1_500_000_000) {
    score -= 6; flags.push('posibila saturare ADC — amplitudine fizic imposibila');
  } else if (peakAbsRaw > 500_000_000) {
    score -= 3; flags.push('amplitudine suspect de mare — verifica senzorul');
  }

  // ══ VETO-URI absolute ══
  // Daca impuls scurt + rise time mic => NICIODATA cutremur, indiferent de score
  const hardVetoTraffic = (riseTimeSec < 0.5 && eventDuration < 3);
  // Daca durata > 30s + spectru seismic => SIGUR cutremur sau potential
  const hardVetoEq = (eventDuration > 30 && ratioSeismic > 0.4);

  if (hardVetoTraffic) score = Math.min(score, -3);
  if (hardVetoEq)      score = Math.max(score, 4);

  // ══ Clasificare finala ══
  let type, confidence;
  if (score >= 6) {
    type = 'earthquake';
    confidence = Math.min(92, 65 + score * 2);
  } else if (score >= 3) {
    type = 'possible_earthquake';
    confidence = Math.min(75, 45 + score * 5);
  } else if (score <= -4) {
    type = 'traffic';
    confidence = Math.min(95, 65 + Math.abs(score) * 3);
  } else if (score <= -2) {
    type = 'noise';
    confidence = Math.min(80, 50 + Math.abs(score) * 5);
  } else {
    type = 'ambient';
    confidence = 50;
  }

  return {
    type,
    confidence: Math.round(confidence),
    score,
    flags,   // motive clasificare
    details: {
      ratioSeismic:        Math.round(ratioSeismic * 100),
      ratioTraffic:        Math.round(ratioTraffic * 100),
      ratioIndustrial:     Math.round(ratioIndustrial * 100),
      ratioInfrasonic:     Math.round(ratioInfrasonic * 100),
      riseTimeSec:         Math.round(riseTimeSec * 10) / 10,
      eventDuration:       Math.round(eventDuration * 10) / 10,
      codaRatio:           Math.round(codaRatio * 100) / 100,
      impulsivity:         Math.round(impulsivity * 10) / 10,
      spectralPersistence: Math.round(spectralPersistence * 100),
      staLtaMax:           Math.round(staLta.maxRatio * 10) / 10,
      staLtaDuration:      Math.round(staLta.triggerDuration * 10) / 10,
      asymmetry:           Math.round(asymmetry * 100),
    },
  };
}

// Hilbert envelope aproximat (rectificare + low-pass)
function computeEnvelope(signal, fs) {
  const abs = signal.map(Math.abs);
  // Smooth cu fereastra de ~0.5s
  const w = Math.max(3, Math.round(fs * 0.5));
  const env = new Array(abs.length).fill(0);
  for (let i = 0; i < abs.length; i++) {
    let sum = 0, cnt = 0;
    for (let j = Math.max(0, i - w); j <= Math.min(abs.length - 1, i + w); j++) {
      sum += abs[j]; cnt++;
    }
    env[i] = sum / cnt;
  }
  return env;
}

// STA/LTA clasic
function computeSTALTA(signal, fs) {
  const staWin = Math.round(fs * 1);   // 1 secunda
  const ltaWin = Math.round(fs * 30);  // 30 secunde
  const threshold = 3.0;

  let maxRatio = 0;
  let triggerCount = 0;

  for (let i = ltaWin; i < signal.length; i++) {
    let sta = 0, lta = 0;
    for (let j = i - staWin; j < i; j++)      sta += signal[j] * signal[j];
    for (let j = i - ltaWin; j < i - staWin; j++) lta += signal[j] * signal[j];
    sta /= staWin;
    lta /= (ltaWin - staWin);
    if (lta > 0) {
      const ratio = sta / lta;
      if (ratio > maxRatio) maxRatio = ratio;
      if (ratio > threshold) triggerCount++;
    }
  }

  return {
    maxRatio,
    triggerDuration: triggerCount / fs,
  };
}

function nextPow2(n) { let p = 1; while (p < n) p <<= 1; return p; }

function fftInPlace(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len;
    const wR = Math.cos(ang), wI = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cR = 1, cI = 0;
      for (let j = 0; j < len / 2; j++) {
        const uR = re[i+j], uI = im[i+j];
        const vR = re[i+j+len/2]*cR - im[i+j+len/2]*cI;
        const vI = re[i+j+len/2]*cI + im[i+j+len/2]*cR;
        re[i+j] = uR+vR; im[i+j] = uI+vI;
        re[i+j+len/2] = uR-vR; im[i+j+len/2] = uI-vI;
        const nr = cR*wR - cI*wI; cI = cR*wI + cI*wR; cR = nr;
      }
    }
  }
}

function decodeMiniSEED(buf) {
  const allSamples = [];
  let sampleRate   = 100;
  let startTime    = null;
  let offset       = 0;

  while (offset + 64 <= buf.length) {
    const indicator = String.fromCharCode(buf[offset + 6]);
    if (!'DRQM'.includes(indicator)) { offset += 512; continue; }

    const view = new DataView(buf.buffer, buf.byteOffset + offset, buf.length - offset);

    // Parse start time from fixed header
    const year      = view.getUint16(20, false);
    const dayOfYear = view.getUint16(22, false);
    const hour      = view.getUint8(24);
    const min       = view.getUint8(25);
    const sec       = view.getUint8(26);
    const frac      = view.getUint16(28, false);

    if (!startTime && year > 2000 && year < 2100) {
      const d = new Date(Date.UTC(year, 0, 1));
      d.setUTCDate(dayOfYear);
      d.setUTCHours(hour, min, sec, Math.round(frac / 10));
      startTime = d.toISOString();
    }

    const numSamples   = view.getUint16(30, false);
    const srateFactor  = view.getInt16(32, false);
    const srateMulti   = view.getInt16(34, false);
    const blkOffset0   = view.getUint16(46, false);
    const dataOffsetH  = view.getUint16(44, false); // data offset from fixed header

    // Sample rate
    if (srateFactor > 0 && srateMulti > 0)      sampleRate = srateFactor * srateMulti;
    else if (srateFactor > 0 && srateMulti < 0) sampleRate = -srateFactor / srateMulti;
    else if (srateFactor < 0 && srateMulti > 0) sampleRate = -srateMulti / srateFactor;
    else if (srateFactor < 0 && srateMulti < 0) sampleRate = 1.0 / (srateFactor * srateMulti);

    // Walk blockette chain to find Blockette 1000
    let dataEncoding = 11;
    let recLength    = 9;
    let dataStart    = dataOffsetH || 64;
    let blkOff       = blkOffset0;

    for (let b = 0; b < 10 && blkOff > 0 && blkOff + 8 < 512; b++) {
      const blkType = view.getUint16(blkOff, false);
      const nextBlk = view.getUint16(blkOff + 2, false);
      if (blkType === 1000) {
        dataEncoding = view.getUint8(blkOff + 4);
        recLength    = view.getUint8(blkOff + 6);
        dataStart    = dataOffsetH;
        break;
      }
      if (nextBlk === 0 || nextBlk <= blkOff) break;
      blkOff = nextBlk;
    }

    const recBytes = 1 << recLength;
    if (recBytes < 64 || offset + recBytes > buf.length) {
      offset += 512; continue;
    }

    const dataView = new DataView(buf.buffer, buf.byteOffset + offset);
    try {
      let recSamples = [];
      if (dataEncoding === 11)      recSamples = decodeSteim2(dataView, dataStart, recBytes, numSamples);
      else if (dataEncoding === 10) recSamples = decodeSteim1(dataView, dataStart, recBytes, numSamples);
      else if (dataEncoding === 3)  recSamples = decodeInt32(dataView, dataStart, recBytes, numSamples);
      else if (dataEncoding === 1)  recSamples = decodeInt16(dataView, dataStart, recBytes, numSamples);
      allSamples.push(...recSamples);
    } catch (_) {}

    offset += recBytes;
  }

  return { samples: allSamples, sampleRate, startTime };
}

function decodeSteim1(view, dataStart, recBytes, numSamples) {
  const diffs = [];
  let x0 = null;
  let frameOffset = dataStart;

  while (frameOffset + 64 <= recBytes && diffs.length < numSamples) {
    const ctrl = view.getUint32(frameOffset, false);
    for (let w = 0; w < 16 && diffs.length < numSamples; w++) {
      const code = (ctrl >>> (30 - w * 2)) & 0x03;
      if (w === 0 && frameOffset === dataStart) {
        x0 = view.getInt32(frameOffset + 4, false);
        continue;
      }
      if (w === 0) continue;
      const word = view.getInt32(frameOffset + w * 4, false);
      if (code === 0) continue;
      else if (code === 1) {
        for (let b = 3; b >= 0 && diffs.length < numSamples; b--) {
          const v = (word >> (b * 8)) & 0xff;
          diffs.push(v > 127 ? v - 256 : v);
        }
      } else if (code === 2) {
        for (let b = 1; b >= 0 && diffs.length < numSamples; b--) {
          const v = (word >> (b * 16)) & 0xffff;
          diffs.push(v > 32767 ? v - 65536 : v);
        }
      } else if (code === 3) {
        diffs.push(word);
      }
    }
    frameOffset += 64;
  }

  if (x0 !== null && diffs.length > 0) {
    const out = [x0];
    for (let i = 1; i < diffs.length; i++) out.push(out[i-1] + diffs[i]);
    return out.slice(0, numSamples);
  }
  return diffs.slice(0, numSamples);
}

function decodeSteim2(view, dataStart, recBytes, numSamples) {
  const diffs = [];
  let x0 = null;
  let frameOffset = dataStart;

  while (frameOffset + 64 <= recBytes && diffs.length < numSamples) {
    const ctrl = view.getUint32(frameOffset, false);

    for (let w = 0; w < 16 && diffs.length < numSamples; w++) {
      const dnib = (ctrl >>> (30 - w * 2)) & 0x03;

      if (w === 0) {
        if (frameOffset === dataStart) x0 = view.getInt32(frameOffset + 4, false);
        continue;
      }
      if (dnib === 0) continue;

      const word = view.getUint32(frameOffset + w * 4, false);

      if (dnib === 1) {
        diffs.push(word | 0);
      } else if (dnib === 2) {
        const cnib = (word >>> 30) & 0x03;
        if (cnib === 0) {
          diffs.push(sign30(word & 0x3FFFFFFF));
        } else if (cnib === 1) {
          diffs.push(sign15((word >>> 15) & 0x7FFF));
          if (diffs.length < numSamples) diffs.push(sign15(word & 0x7FFF));
        } else if (cnib === 2) {
          diffs.push(sign10((word >>> 20) & 0x3FF));
          if (diffs.length < numSamples) diffs.push(sign10((word >>> 10) & 0x3FF));
          if (diffs.length < numSamples) diffs.push(sign10(word & 0x3FF));
        } else {
          for (let i = 4; i >= 0 && diffs.length < numSamples; i--)
            diffs.push(sign6((word >>> (i * 6)) & 0x3F));
        }
      } else if (dnib === 3) {
        const cnib = (word >>> 30) & 0x03;
        if (cnib === 0) {
          for (let i = 5; i >= 0 && diffs.length < numSamples; i--)
            diffs.push(sign5((word >>> (i * 5)) & 0x1F));
        } else if (cnib === 1) {
          for (let i = 6; i >= 0 && diffs.length < numSamples; i--)
            diffs.push(sign4((word >>> (i * 4)) & 0x0F));
        }
      }
    }
    frameOffset += 64;
  }

  if (x0 !== null && diffs.length > 0) {
    const out = new Array(Math.min(diffs.length, numSamples));
    out[0] = x0;
    for (let i = 1; i < out.length; i++) out[i] = out[i-1] + diffs[i];
    return out;
  }
  return diffs.slice(0, numSamples);
}

function decodeInt32(view, ds, rb, n) {
  const out = [];
  for (let i = 0; i < n && ds + i*4 + 4 <= rb; i++) out.push(view.getInt32(ds + i*4, false));
  return out;
}
function decodeInt16(view, ds, rb, n) {
  const out = [];
  for (let i = 0; i < n && ds + i*2 + 2 <= rb; i++) out.push(view.getInt16(ds + i*2, false));
  return out;
}

function sign30(v) { return v & 0x20000000 ? v - 0x40000000 : v; }
function sign15(v) { return v & 0x4000 ? v - 0x8000 : v; }
function sign10(v) { return v & 0x200 ? v - 0x400 : v; }
function sign6(v)  { return v & 0x20 ? v - 0x40 : v; }
function sign5(v)  { return v & 0x10 ? v - 0x20 : v; }
function sign4(v)  { return v & 0x08 ? v - 0x10 : v; }

function corsHeaders() { return { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-cache' }; }
function json400(b) { return { statusCode: 400, headers: { ...corsHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(b) }; }
function json500(b) { return { statusCode: 500, headers: { ...corsHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(b) }; }
