/**
 * Linear resampling that carries its position across frames
 * (voice-bridge design D11).
 *
 * A stateless per-frame resampler is the obvious wrong answer: each frame
 * restarts at position zero, so every frame boundary gets a small
 * discontinuity and the output slowly gains or loses samples against the
 * input. Over a three-minute call at fifty frames a second that is nine
 * thousand boundaries, and it is audible.
 *
 * So the converter tracks two absolute counters — how many input samples it has
 * consumed, and which output sample comes next — and derives every read
 * position from them. Positions are exact rather than accumulated, so there is
 * nothing to drift.
 */
export class Resampler {
  /** Input samples per output sample. */
  private readonly ratio: number;
  /** Absolute count of input samples handed over before the current frame. */
  private consumed = 0;
  /** Index of the next output sample to produce, in absolute output time. */
  private nextOut = 0;
  /** The final sample of the previous frame, so a read may straddle the seam. */
  private previous = 0;
  private started = false;

  constructor(
    readonly inputRate: number,
    readonly outputRate: number,
  ) {
    if (inputRate <= 0 || outputRate <= 0) throw new RangeError("sample rates must be positive");
    this.ratio = inputRate / outputRate;
  }

  /** Resamples one frame, holding back whatever needs the next frame to finish. */
  process(input: Int16Array): Int16Array {
    if (input.length === 0) return new Int16Array(0);

    // The first sample has no predecessor, so it stands in as its own.
    if (!this.started) {
      this.previous = input[0]!;
      this.started = true;
    }

    const first = this.consumed - 1; // index of `previous` in absolute input time
    const last = this.consumed + input.length - 1;
    const at = (index: number): number => (index === first ? this.previous : input[index - this.consumed]!);

    const out: number[] = [];
    for (;;) {
      const position = this.nextOut * this.ratio;
      const index = Math.floor(position);
      // Both endpoints of the interpolation have to be in hand. When the second
      // is not, the output sample waits for the next frame rather than being
      // approximated from a sample that has not arrived.
      if (index < first || index + 1 > last) break;
      const fraction = position - index;
      const a = at(index);
      const b = at(index + 1);
      out.push(Math.round(a + (b - a) * fraction));
      this.nextOut += 1;
    }

    this.consumed += input.length;
    this.previous = input[input.length - 1]!;
    return Int16Array.from(out);
  }

  /** Output samples produced so far, for tests and diagnostics. */
  get producedSamples(): number {
    return this.nextOut;
  }
}
