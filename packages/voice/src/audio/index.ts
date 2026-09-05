import { decode, encode } from "./mulaw";
import { Resampler } from "./resample";

export { decode as mulawDecode, encode as mulawEncode, decodeSample, encodeSample } from "./mulaw";
export { Resampler } from "./resample";

/**
 * The audio formats on each side of the bridge.
 *
 * The rates are configuration, not constants, because the design's task 1.2
 * spike measured them rather than trusting documentation, and the next preview
 * of the model may measure differently. The output rate below is MEASURED:
 * Gemini Live native audio returns `audio/pcm;rate=24000`. The input rate is
 * what the API documents and is not yet confirmed against real speech; the
 * browser harness confirms it.
 */
export type AudioFormats = {
  /** Twilio Media Streams: 8 kHz mu-law, always. */
  telephonyRate: number;
  /** PCM16 the model accepts. */
  modelInputRate: number;
  /** PCM16 the model returns. */
  modelOutputRate: number;
};

export const DEFAULT_FORMATS: AudioFormats = {
  telephonyRate: 8000,
  modelInputRate: 16000,
  modelOutputRate: 24000,
};

/**
 * The two directions of one call, each holding its own resampler state.
 *
 * One object rather than two loose functions, because the state is the whole
 * point: the converters must be per call and must not be shared between them.
 */
export class CallAudio {
  private readonly toModel: Resampler;
  private readonly toTelephony: Resampler;

  constructor(readonly formats: AudioFormats = DEFAULT_FORMATS) {
    this.toModel = new Resampler(formats.telephonyRate, formats.modelInputRate);
    this.toTelephony = new Resampler(formats.modelOutputRate, formats.telephonyRate);
  }

  /** A Twilio media payload (base64 mu-law) to PCM16 at the model's input rate. */
  fromTelephony(payloadBase64: string): Int16Array {
    return this.toModel.process(decode(Buffer.from(payloadBase64, "base64")));
  }

  /** A model audio chunk (base64 PCM16) to a Twilio media payload (base64 mu-law). */
  fromModel(payloadBase64: string): string {
    const raw = Buffer.from(payloadBase64, "base64");
    return encode(this.toTelephony.process(pcm16(raw))).toString("base64");
  }
}

/**
 * Little-endian PCM16 bytes as samples.
 *
 * Copied rather than viewed: a Buffer from `Buffer.from(base64)` may sit at a
 * non-even offset inside a pooled ArrayBuffer, and `new Int16Array(buffer)`
 * throws on an unaligned offset. An odd trailing byte is a truncated sample and
 * is dropped rather than read past.
 */
export function pcm16(bytes: Buffer): Int16Array {
  const samples = new Int16Array(bytes.length >> 1);
  for (let i = 0; i < samples.length; i += 1) samples[i] = bytes.readInt16LE(i * 2);
  return samples;
}

/** Samples as little-endian PCM16 bytes. */
export function pcm16Bytes(samples: Int16Array): Buffer {
  const out = Buffer.allocUnsafe(samples.length * 2);
  for (let i = 0; i < samples.length; i += 1) out.writeInt16LE(samples[i]!, i * 2);
  return out;
}
