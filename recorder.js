// Studio-Recorder: nimmt das rohe Mikrofonsignal unkomprimiert auf (WAV, 24 Bit).
// Echo-Unterdrückung, Rauschfilter und automatische Lautstärke sind AUS,
// damit die Stimme so natürlich wie möglich bleibt.

const WORKLET_SRC = `
class Tap extends AudioWorkletProcessor {
  constructor() { super(); this.buf = new Float32Array(2048); this.n = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) {
      for (let i = 0; i < ch.length; i++) {
        this.buf[this.n++] = ch[i];
        if (this.n === this.buf.length) { this.port.postMessage(this.buf.slice(0)); this.n = 0; }
      }
    }
    return true;
  }
}
registerProcessor('tap', Tap);
`;

export class StudioRecorder {
  constructor() {
    this.ctx = null; this.stream = null; this.node = null; this.src = null;
    this.recording = false; this.chunks = []; this.pre = []; this.preLen = 0;
    this.sampleRate = 48000; this.onLevel = null; this.onWave = null;
    this.peakHold = 0; this.clipped = false; this.preSec = 0;
  }

  get active() { return !!this.stream; }

  async start(deviceId) {
    await this.stop();
    const audio = {
      echoCancellation: false, noiseSuppression: false, autoGainControl: false,
      channelCount: { ideal: 1 }, sampleRate: { ideal: 48000 }, sampleSize: { ideal: 24 },
    };
    if (deviceId) audio.deviceId = { exact: deviceId };
    this.stream = await navigator.mediaDevices.getUserMedia({ audio });
    const track = this.stream.getAudioTracks()[0];
    const rate = track.getSettings().sampleRate;
    try { this.ctx = new AudioContext(rate ? { sampleRate: rate, latencyHint: 'interactive' } : {}); }
    catch { this.ctx = new AudioContext(); }
    this.sampleRate = this.ctx.sampleRate;
    const url = URL.createObjectURL(new Blob([WORKLET_SRC], { type: 'application/javascript' }));
    await this.ctx.audioWorklet.addModule(url);
    URL.revokeObjectURL(url);
    this.src = this.ctx.createMediaStreamSource(this.stream);
    this.node = new AudioWorkletNode(this.ctx, 'tap', { numberOfInputs: 1, numberOfOutputs: 0, channelCount: 1, channelCountMode: 'explicit' });
    this.node.port.onmessage = (e) => this._onChunk(e.data);
    this.src.connect(this.node);
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    return track.label || 'Mikrofon';
  }

  _onChunk(d) {
    let peak = 0;
    for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); if (a > peak) peak = a; }
    if (this.recording) {
      this.chunks.push(d);
      if (peak >= 0.995) this.clipped = true;
      this.onWave && this.onWave(peak);
    } else {
      // ~0,3 s "Vorlauf", damit der allererste Laut nie abgeschnitten wird
      this.pre.push(d); this.preLen += d.length;
      const max = this.sampleRate * 0.3;
      while (this.preLen - this.pre[0].length > max) this.preLen -= this.pre.shift().length;
    }
    this.onLevel && this.onLevel(peak);
  }

  begin() {
    this.preSec = this.preLen / this.sampleRate;
    this.chunks = this.pre.slice(); this.pre = []; this.preLen = 0;
    this.clipped = false; this.recording = true;
  }

  end() {
    this.recording = false;
    const total = this.chunks.reduce((s, c) => s + c.length, 0);
    const pcm = new Float32Array(total);
    let o = 0; for (const c of this.chunks) { pcm.set(c, o); o += c.length; }
    this.chunks = [];
    return { blob: encodeWav(pcm, this.sampleRate), duration: total / this.sampleRate, clipped: this.clipped, sampleRate: this.sampleRate };
  }

  async stop() {
    this.recording = false;
    try { this.src && this.src.disconnect(); } catch {}
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
    if (this.ctx) try { await this.ctx.close(); } catch {}
    this.ctx = this.stream = this.node = this.src = null;
  }

  static async devices() {
    const all = await navigator.mediaDevices.enumerateDevices();
    return all.filter((d) => d.kind === 'audioinput');
  }
}

export function encodeWav(pcm, rate) {
  const bytes = 3, n = pcm.length;
  const buf = new ArrayBuffer(44 + n * bytes);
  const v = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + n * bytes, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * bytes, true); v.setUint16(32, bytes, true); v.setUint16(34, 24, true);
  str(36, 'data'); v.setUint32(40, n * bytes, true);
  let o = 44;
  for (let i = 0; i < n; i++) {
    let s = Math.max(-1, Math.min(1, pcm[i]));
    let x = Math.round(s < 0 ? s * 0x800000 : s * 0x7fffff);
    if (x < 0) x += 0x1000000;
    v.setUint8(o, x & 0xff); v.setUint8(o + 1, (x >> 8) & 0xff); v.setUint8(o + 2, (x >> 16) & 0xff);
    o += 3;
  }
  return new Blob([buf], { type: 'audio/wav' });
}

// Schneidet ein 24-Bit-Mono-WAV auf maxSec Sekunden (ohne Neukodierung)
export function trimWav(blob, maxSec, rate) {
  return blob.arrayBuffer ? (async () => {
    const buf = await blob.arrayBuffer(); const bytes = 3;
    const n = Math.min((buf.byteLength - 44) / bytes, Math.round(maxSec * rate));
    const out = buf.slice(0, 44 + n * bytes); const v = new DataView(out);
    v.setUint32(4, 36 + n * bytes, true); v.setUint32(40, n * bytes, true);
    return new Blob([out], { type: 'audio/wav' });
  })() : blob;
}
