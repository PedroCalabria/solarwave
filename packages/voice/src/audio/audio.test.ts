import { describe, expect, it } from "vitest";
import { CallAudio, DEFAULT_FORMATS, mulawDecode, mulawEncode, pcm16, pcm16Bytes, Resampler } from "./index";

/** A sine wave, the signal every audio bug shows up in. */
function tone(samples: number, rate: number, hz = 440, amplitude = 12000, phase = 0): Int16Array {
  const out = new Int16Array(samples);
  for (let i = 0; i < samples; i += 1) {
    out[i] = Math.round(amplitude * Math.sin(2 * Math.PI * hz * ((i + phase) / rate)));
  }
  return out;
}

/** Signal-to-noise ratio in dB between an original and its round trip. */
function snr(original: Int16Array, actual: Int16Array): number {
  let signal = 0;
  let noise = 0;
  for (let i = 0; i < original.length; i += 1) {
    const o = original[i]!;
    const error = o - actual[i]!;
    signal += o * o;
    noise += error * error;
  }
  return 10 * Math.log10(signal / Math.max(noise, 1e-12));
}

describe("mu-law", () => {
  it("round-trips a tone within the codec's own accuracy", () => {
    const original = tone(8000, 8000);
    const decoded = mulawDecode(mulawEncode(original));
    // G.711 mu-law is a lossy 8-bit companding codec; 30 dB is its published
    // ballpark for speech-level signals. A format bug lands far below this.
    expect(snr(original, decoded)).toBeGreaterThan(30);
  });

  it("uses exactly one byte per sample", () => {
    expect(mulawEncode(tone(160, 8000))).toHaveLength(160);
    expect(mulawDecode(mulawEncode(tone(160, 8000)))).toHaveLength(160);
  });

  it("round-trips every representable byte exactly", () => {
    // Decode then encode is the identity for every code except 127, which is
    // mu-law's negative zero: G.711 has two codes for zero and encoding picks
    // the positive one. A wrong bias or shift breaks the other 255.
    for (let byte = 0; byte < 256; byte += 1) {
      if (byte === 127) continue;
      const decoded = mulawDecode(Uint8Array.of(byte));
      expect(mulawEncode(decoded)[0]).toBe(byte);
    }
  });

  it("has two codes for zero, as G.711 specifies", () => {
    expect(mulawDecode(Uint8Array.of(127))[0]).toBe(0);
    expect(mulawDecode(Uint8Array.of(255))[0]).toBe(0);
  });

  it("keeps silence silent and clips instead of wrapping", () => {
    expect(mulawDecode(mulawEncode(Int16Array.of(0)))[0]).toBe(0);
    const loud = mulawDecode(mulawEncode(Int16Array.of(32767, -32768)));
    expect(loud[0]).toBeGreaterThan(30000);
    expect(loud[1]).toBeLessThan(-30000);
  });

  it("preserves sign above its own quantisation floor", () => {
    for (const sample of [-20000, -8000, -100, -32, 32, 100, 8000, 20000]) {
      const back = mulawDecode(mulawEncode(Int16Array.of(sample)))[0]!;
      expect(Math.sign(back)).toBe(Math.sign(sample));
    }
  });

  it("quantises the smallest samples to zero and the next step to eight", () => {
    // Measured, not assumed: only +/-1 falls in mu-law's zero step, and the
    // step above it lands on +/-8. That is the codec, not a bug, and it is
    // inaudible against speech at 8 kHz.
    for (const sample of [-1, 0, 1]) {
      expect(mulawDecode(mulawEncode(Int16Array.of(sample)))[0]).toBe(0);
    }
    expect(mulawDecode(mulawEncode(Int16Array.of(4)))[0]).toBe(8);
    expect(mulawDecode(mulawEncode(Int16Array.of(-4)))[0]).toBe(-8);
  });
});

describe("resampling", () => {
  /**
   * The converter holds back the output samples whose second interpolation
   * endpoint has not arrived, so it always trails the input by a little. The
   * point of these tests is that the lag is CONSTANT: a lag that grows is
   * drift, and drift is what makes a long call slide out of sync.
   */
  const lagAfter = (inRate: number, outRate: number, frameSamples: number, frames: number): number => {
    const resampler = new Resampler(inRate, outRate);
    for (let f = 0; f < frames; f += 1) {
      resampler.process(tone(frameSamples, inRate, 440, 12000, f * frameSamples));
    }
    const expected = (frames * frameSamples * outRate) / inRate;
    return expected - resampler.producedSamples;
  };

  it("upsampling lags by a bounded amount that never grows", () => {
    // 20 ms Twilio frames. 9000 of them is three minutes: the hard-stop budget.
    const short = lagAfter(8000, 16000, 160, 100);
    const full = lagAfter(8000, 16000, 160, 9000);
    expect(full).toBe(short);
    expect(full).toBeLessThanOrEqual(Math.ceil(16000 / 8000));
  });

  it("downsampling lags by a bounded amount that never grows", () => {
    const short = lagAfter(24000, 8000, 480, 100);
    const full = lagAfter(24000, 8000, 480, 9000);
    expect(full).toBe(short);
    expect(full).toBeLessThanOrEqual(1);
  });

  it("is continuous across a frame boundary", () => {
    const whole = tone(320, 8000);
    const framed = new Resampler(8000, 16000);
    const a = framed.process(whole.slice(0, 160));
    const b = framed.process(whole.slice(160));
    const joined = Int16Array.from([...a, ...b]);

    const once = new Resampler(8000, 16000).process(whole);
    // Splitting the input must not change the output: same samples, same count.
    expect(joined.length).toBe(once.length);
    for (let i = 0; i < joined.length; i += 1) expect(joined[i]).toBe(once[i]);
  });

  it("keeps a tone smooth across many boundaries", () => {
    const resampler = new Resampler(8000, 16000);
    const out: number[] = [];
    for (let f = 0; f < 50; f += 1) out.push(...resampler.process(tone(160, 8000, 440, 12000, f * 160)));
    // A discontinuity at a seam shows up as a step far larger than the largest
    // step a 440 Hz tone can take between two samples at 16 kHz.
    const largestRealStep = 12000 * 2 * Math.PI * (440 / 16000);
    for (let i = 1; i < out.length; i += 1) {
      expect(Math.abs(out[i]! - out[i - 1]!)).toBeLessThan(largestRealStep * 2);
    }
  });

  it("passes a signal through unchanged when the rates match", () => {
    const input = tone(160, 8000);
    const resampler = new Resampler(8000, 8000);
    const first = resampler.process(input);
    // One sample is held back for the next frame, and arrives with it.
    expect(first.length).toBe(input.length - 1);
    for (let i = 0; i < first.length; i += 1) expect(first[i]).toBe(input[i]);
    const second = resampler.process(input);
    expect(second[0]).toBe(input[input.length - 1]);
  });

  it("handles an empty frame", () => {
    expect(new Resampler(8000, 16000).process(new Int16Array(0))).toHaveLength(0);
  });

  it("rejects a nonsensical rate", () => {
    expect(() => new Resampler(0, 16000)).toThrow(RangeError);
    expect(() => new Resampler(8000, -1)).toThrow(RangeError);
  });
});

describe("PCM16 framing", () => {
  it("round-trips samples through bytes", () => {
    const samples = Int16Array.of(0, 1, -1, 32767, -32768, 1234);
    expect([...pcm16(pcm16Bytes(samples))]).toEqual([...samples]);
  });

  it("drops a truncated trailing byte instead of reading past it", () => {
    expect(pcm16(Buffer.of(0x01, 0x02, 0x03))).toHaveLength(1);
  });

  it("reads a buffer at an odd offset in its pool", () => {
    // Buffer.from(base64) can land unaligned inside a pooled ArrayBuffer, which
    // is why the samples are copied rather than viewed.
    const pool = Buffer.alloc(9);
    pcm16Bytes(Int16Array.of(100, -100, 300, -300)).copy(pool, 1);
    expect([...pcm16(pool.subarray(1))]).toEqual([100, -100, 300, -300]);
  });
});

describe("CallAudio", () => {
  it("carries a tone from the phone to the model and back", () => {
    const audio = new CallAudio();
    const original = tone(800, 8000);
    const payload = mulawEncode(original).toString("base64");

    const toModel = audio.fromTelephony(payload);
    expect(toModel.length).toBeCloseTo((original.length * DEFAULT_FORMATS.modelInputRate) / 8000, -1);

    const back = mulawDecode(Buffer.from(audio.fromModel(pcm16Bytes(tone(2400, 24000)).toString("base64")), "base64"));
    // 2400 samples at 24 kHz is 100 ms, which is 800 samples at 8 kHz.
    expect(Math.abs(back.length - 800)).toBeLessThanOrEqual(2);
  });

  it("honours a model output rate other than the default", () => {
    const audio = new CallAudio({ ...DEFAULT_FORMATS, modelOutputRate: 16000 });
    // 1600 samples at 16 kHz is 100 ms, which is 800 samples at 8 kHz. Reading
    // the rate from configuration is what stops a pitch error on a live call.
    const out = audio.fromModel(pcm16Bytes(tone(1600, 16000)).toString("base64"));
    expect(Math.abs(Buffer.from(out, "base64").length - 800)).toBeLessThanOrEqual(2);
  });

  it("keeps each direction's state independent", () => {
    const audio = new CallAudio();
    audio.fromTelephony(mulawEncode(tone(160, 8000)).toString("base64"));
    const out = audio.fromModel(pcm16Bytes(tone(480, 24000)).toString("base64"));
    expect(Buffer.from(out, "base64").length).toBeGreaterThan(0);
  });
});
