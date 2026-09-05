/**
 * G.711 mu-law, the codec Twilio Media Streams speaks (voice-bridge design D11).
 *
 * Hand-written rather than pulled in: it is a lookup table and a bit layout,
 * the bug we actually fear is a format mismatch that makes the agent sound like
 * a chipmunk on a real call, and that bug is caught by a unit test either way —
 * but only if the code is ours to test.
 */

/** Added before encoding so the exponent search has a floor. Part of G.711. */
const BIAS = 0x84;
/** Largest magnitude mu-law can carry; louder samples clip. */
const CLIP = 32635;

/**
 * Exponent for a biased sample, indexed by its top byte: the position of the
 * highest set bit. Built rather than transcribed, because a mistyped entry in a
 * 256-number table is invisible and this is one line.
 */
const EXPONENT = new Uint8Array(256);
for (let i = 1; i < 256; i += 1) EXPONENT[i] = 31 - Math.clz32(i);

/** Decoded value for each of the 256 mu-law bytes. */
const DECODE = new Int16Array(256);
for (let byte = 0; byte < 256; byte += 1) {
  const u = ~byte & 0xff;
  let magnitude = ((u & 0x0f) << 3) + BIAS;
  magnitude <<= (u & 0x70) >> 4;
  DECODE[byte] = (u & 0x80) === 0 ? magnitude - BIAS : BIAS - magnitude;
}

/** One 16-bit sample to one mu-law byte. */
export function encodeSample(sample: number): number {
  const sign = sample < 0 ? 0x80 : 0;
  let magnitude = sample < 0 ? -sample : sample;
  if (magnitude > CLIP) magnitude = CLIP;
  magnitude += BIAS;
  const exponent = EXPONENT[(magnitude >> 7) & 0xff]!;
  const mantissa = (magnitude >> (exponent + 3)) & 0x0f;
  return ~(sign | (exponent << 4) | mantissa) & 0xff;
}

/** One mu-law byte back to a 16-bit sample. */
export function decodeSample(byte: number): number {
  return DECODE[byte & 0xff]!;
}

/** PCM16 samples to a mu-law buffer, one byte per sample. */
export function encode(samples: Int16Array): Buffer {
  const out = Buffer.allocUnsafe(samples.length);
  for (let i = 0; i < samples.length; i += 1) out[i] = encodeSample(samples[i]!);
  return out;
}

/** A mu-law buffer to PCM16 samples. */
export function decode(bytes: Uint8Array): Int16Array {
  const out = new Int16Array(bytes.length);
  for (let i = 0; i < bytes.length; i += 1) out[i] = DECODE[bytes[i]!]!;
  return out;
}
