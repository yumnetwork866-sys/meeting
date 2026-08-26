// AudioWorkletProcessor that captures mono audio, downsamples to 16 kHz,
// converts Float32 -> Int16 little-endian, and posts ArrayBuffers to the main
// thread roughly every ~100 ms.

class PCMRecorderProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const opts = (options && options.processorOptions) || {};
    this.targetSampleRate = opts.targetSampleRate || 16000;
    this.framesPerPacket = Math.floor(this.targetSampleRate * 0.1); // ~100 ms

    this.ratio = sampleRate / this.targetSampleRate; // input fps / target fps
    this.acc = []; // accumulated downsampled Int16 samples
    this.srcPos = 0; // fractional position in source stream (per render quantum)
  }

  // Linear-resample one render quantum (128 frames of input) into target rate samples.
  // We keep srcPos across calls so the resampling stream is continuous.
  _downsample(channel) {
    const out = [];
    let pos = this.srcPos;
    while (pos < channel.length) {
      const i = Math.floor(pos);
      const frac = pos - i;
      const s1 = channel[i];
      const s2 = i + 1 < channel.length ? channel[i + 1] : s1;
      const sample = s1 + (s2 - s1) * frac;
      // clamp + scale to Int16
      const clamped = Math.max(-1, Math.min(1, sample));
      out.push(clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff);
      pos += this.ratio;
    }
    this.srcPos = pos - channel.length; // carry-over fractional position
    return out;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    const channel = input[0];
    if (!channel || channel.length === 0) return true;

    const ds = this._downsample(channel);
    for (let i = 0; i < ds.length; i++) this.acc.push(ds[i]);

    while (this.acc.length >= this.framesPerPacket) {
      const slice = this.acc.splice(0, this.framesPerPacket);
      const buf = new ArrayBuffer(slice.length * 2);
      const view = new DataView(buf);
      for (let i = 0; i < slice.length; i++) {
        view.setInt16(i * 2, slice[i] | 0, true); // little-endian
      }
      this.port.postMessage(buf, [buf]);
    }

    return true;
  }
}

registerProcessor('pcm-recorder-processor', PCMRecorderProcessor);
