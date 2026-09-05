/**
 * Microphone capture for the voice harness (voice-bridge task 7.1).
 *
 * An AudioWorklet rather than a ScriptProcessorNode: capture runs on the audio
 * thread, so a busy main thread drops no samples and the agent does not hear
 * gaps that were never in the room.
 *
 * The AudioContext is created at the model's input rate, so there is no
 * resampling here at all — the browser does it, in C++, before we see a sample.
 * Float32 in [-1, 1] becomes PCM16 and goes out as a transferable buffer.
 */
class CaptureProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0]?.[0];
    if (!channel) return true;

    const pcm = new Int16Array(channel.length);
    for (let i = 0; i < channel.length; i += 1) {
      // Clamp before scaling: a sample slightly outside the range would wrap to
      // the opposite extreme and arrive as a click.
      const sample = Math.max(-1, Math.min(1, channel[i]));
      pcm[i] = Math.round(sample * (sample < 0 ? 0x8000 : 0x7fff));
    }
    this.port.postMessage(pcm.buffer, [pcm.buffer]);
    return true;
  }
}

registerProcessor("harness-capture", CaptureProcessor);
