/**
 * Microphone capture for the voice harness (voice-bridge task 7.1).
 *
 * An AudioWorklet rather than a ScriptProcessorNode: capture runs on the audio
 * thread, so a busy main thread drops no samples and the agent does not hear
 * gaps that were never in the room.
 *
 * The AudioContext is created at the model's input rate, so there is no
 * resampling here at all — the browser does it, in C++, before we see a sample.
 * Float32 in [-1, 1] becomes PCM16.
 *
 * Samples are ACCUMULATED before being posted. A worklet is called once per
 * 128-sample render quantum, which at 16 kHz is every 8 ms: posting each one
 * meant about 125 WebSocket frames a second, each becoming its own realtime
 * API call. Telephony sends 20 ms frames; 40 ms here is comfortably inside
 * that budget and cuts the traffic by a factor of five.
 */
const FRAME_MS = 40;

class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.frameSamples = Math.round((sampleRate * FRAME_MS) / 1000);
    this.buffer = new Int16Array(this.frameSamples);
    this.filled = 0;
  }

  process(inputs) {
    const channel = inputs[0]?.[0];
    if (!channel) return true;

    for (let i = 0; i < channel.length; i += 1) {
      // Clamp before scaling: a sample slightly outside the range would wrap to
      // the opposite extreme and arrive as a click.
      const sample = Math.max(-1, Math.min(1, channel[i]));
      this.buffer[this.filled] = Math.round(sample * (sample < 0 ? 0x8000 : 0x7fff));
      this.filled += 1;

      if (this.filled === this.frameSamples) {
        // A copy, because the buffer is reused for the next frame and a
        // transferred one would be detached out from under us.
        this.port.postMessage(this.buffer.slice().buffer);
        this.filled = 0;
      }
    }
    return true;
  }
}

registerProcessor("harness-capture", CaptureProcessor);
