"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { PillButton } from "@/components/ds/soltera";
import styles from "@/app/portal/portal.module.css";

/**
 * Drives a real Gemini Live session from the microphone, with no telephony
 * (voice-bridge design D1).
 *
 * It shows what the agent DID and not only what it said: every tool call with
 * its arguments, and the end reason with the attempt outcome it would map to.
 * An operator should be able to see that a guardrail fired, rather than infer
 * it from the audio.
 *
 * Nothing here is persisted. The server writes no attempt, moves no lead and
 * runs no scoring.
 */

/** PCM16 the model accepts, and PCM16 it returns. Both measured, not assumed. */
const CAPTURE_RATE = 16000;
const PLAYBACK_RATE = 24000;

type Turn = { who: "ai" | "lead"; text: string; interrupted?: boolean };
type ToolCall = { name: string; input: unknown; at: number };
type Ended = {
  endedReason: string;
  outcome: string;
  cutOff: boolean;
  stoppedBy: string;
  transportClose?: { code?: number; reason?: string };
  transportError?: string;
  durationSeconds: number;
  liveAnswers: { criterionKey: string; value: string }[];
  rejectedToolCalls: { name: string; input: unknown }[];
};

/** Plain English for the thing that ended the call. */
const STOPPED_BY: Record<string, string> = {
  agent: "the agent, with end_call",
  hard_stop: "the hard stop",
  wrap_up_budget: "the wrap-up budget",
  transport_closed: "the model closed the socket",
  transport_error: "the model socket errored",
  hung_up: "you, from this page",
};

type Status = "idle" | "connecting" | "live" | "ended" | "error";

/** Plays agent audio in order, and can drop everything queued on a barge-in. */
class Playback {
  /**
   * Scheduling headroom. Chunks arrive over a network and a socket, so lining
   * the first one up with `currentTime` exactly means every later hiccup lands
   * as a gap mid-sentence. A short lead-in absorbs the jitter and costs the
   * listener a delay they cannot perceive.
   */
  private static readonly LEAD_IN_SECONDS = 0.12;

  private context: AudioContext | null = null;
  private playAt = 0;
  private sources = new Set<AudioBufferSourceNode>();

  private ensure(): AudioContext {
    this.context ??= new AudioContext({ sampleRate: PLAYBACK_RATE });
    return this.context;
  }

  push(pcm: Int16Array) {
    const context = this.ensure();
    const buffer = context.createBuffer(1, pcm.length, PLAYBACK_RATE);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < pcm.length; i += 1) channel[i] = pcm[i]! / 0x8000;

    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    // Schedule against a running cursor rather than "now", so consecutive
    // chunks butt up against each other instead of overlapping or gapping.
    this.playAt = Math.max(this.playAt, context.currentTime + Playback.LEAD_IN_SECONDS);
    source.start(this.playAt);
    this.playAt += buffer.duration;

    this.sources.add(source);
    source.onended = () => this.sources.delete(source);
  }

  /** Barge-in: the lead is talking, so nothing already queued should be heard. */
  flush() {
    for (const source of this.sources) {
      try {
        source.stop();
      } catch {
        // Already finished; nothing to stop.
      }
    }
    this.sources.clear();
    this.playAt = this.context?.currentTime ?? 0;
  }

  async close() {
    this.flush();
    await this.context?.close();
    this.context = null;
  }
}

export function VoiceHarness() {
  const [status, setStatus] = useState<Status>("idle");
  const [language, setLanguage] = useState<"pt" | "en">("pt");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [tools, setTools] = useState<ToolCall[]>([]);
  const [ended, setEnded] = useState<Ended | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(0);

  const socket = useRef<WebSocket | null>(null);
  const playback = useRef<Playback | null>(null);
  const capture = useRef<{ context: AudioContext; stream: MediaStream } | null>(null);

  const teardown = useCallback(async () => {
    socket.current?.close();
    socket.current = null;
    capture.current?.stream.getTracks().forEach((t) => t.stop());
    await capture.current?.context.close();
    capture.current = null;
    await playback.current?.close();
    playback.current = null;
  }, []);

  useEffect(() => () => void teardown(), [teardown]);

  useEffect(() => {
    if (status !== "live") return;
    const id = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [status]);

  const start = async () => {
    setTurns([]);
    setTools([]);
    setEnded(null);
    setError(null);
    setSeconds(0);
    setStatus("connecting");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
      });
      // The context runs at the model's input rate, so the browser resamples
      // the microphone for us and the worklet has nothing to convert.
      const context = new AudioContext({ sampleRate: CAPTURE_RATE });
      await context.audioWorklet.addModule("/harness-capture.js");
      capture.current = { context, stream };

      const url = new URL("/api/harness", window.location.href);
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      url.searchParams.set("language", language);
      const ws = new WebSocket(url);
      ws.binaryType = "arraybuffer";
      socket.current = ws;
      playback.current = new Playback();

      ws.onopen = () => {
        const source = context.createMediaStreamSource(stream);
        const worklet = new AudioWorkletNode(context, "harness-capture");
        worklet.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
          if (ws.readyState === WebSocket.OPEN) ws.send(event.data);
        };
        source.connect(worklet);
        // Connecting the worklet to the destination would echo the microphone
        // into the speakers; a zero-gain sink keeps the graph pulling instead.
        const silence = context.createGain();
        silence.gain.value = 0;
        worklet.connect(silence).connect(context.destination);
        setStatus("live");
      };

      ws.onmessage = (event) => {
        if (event.data instanceof ArrayBuffer) {
          playback.current?.push(new Int16Array(event.data));
          return;
        }
        const message = JSON.parse(String(event.data));
        switch (message.type) {
          case "transcript":
            setTurns(message.turns);
            break;
          case "tool":
            setTools((t) => [...t, { name: message.name, input: message.input, at: Date.now() }]);
            break;
          case "interrupted":
            playback.current?.flush();
            break;
          case "ended":
            setEnded(message);
            setStatus("ended");
            void teardown();
            break;
          case "error":
            setError(message.message);
            setStatus("error");
            void teardown();
            break;
        }
      };

      ws.onerror = () => {
        setError("The connection failed. Is this running under `pnpm dev:voice`? `next dev` does not upgrade.");
        setStatus("error");
      };
      ws.onclose = () => setStatus((s) => (s === "live" || s === "connecting" ? "ended" : s));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus("error");
      await teardown();
    }
  };

  const stop = () => {
    socket.current?.send(JSON.stringify({ type: "stop" }));
  };

  const live = status === "live" || status === "connecting";

  return (
    <div style={{ display: "grid", gap: "var(--space-4)" }}>
      <div style={{ background: "var(--surface-card)", borderRadius: "var(--radius-xl)", padding: 22 }}>
        <div className={styles.mono}>Microphone harness</div>
        <p
          style={{
            fontSize: "var(--body-3)",
            lineHeight: 1.55,
            margin: "var(--space-2) 0 0",
            padding: "10px 14px",
            borderRadius: "var(--radius-lg, 12px)",
            border: "1px solid var(--line-hairline)",
            textWrap: "pretty",
          }}
        >
          <strong>Wear headphones.</strong> On speakers the microphone picks the agent&rsquo;s own voice back up, and
          because the lead talking is what interrupts it, the agent interrupts itself — turns stall, replies never
          arrive, audio sticks. That is the harness hearing an echo, not the agent misbehaving. A real telephone call
          has no such loop.
        </p>
        <p style={{ fontSize: "var(--body-3)", lineHeight: 1.55, color: "var(--text-muted)", margin: "var(--space-2) 0 var(--space-3)", textWrap: "pretty" }}>
          Runs the real voice agent against your microphone: the same script, the same tools and the same timers a
          telephone call uses. It places no call and writes nothing — no attempt, no lead change, no score. It does
          spend realtime model quota.
        </p>

        <div style={{ display: "flex", gap: "var(--space-3)", alignItems: "center", flexWrap: "wrap" }}>
          <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: "var(--body-3)" }}>
            Language
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value as "pt" | "en")}
              disabled={live}
              style={{
                height: "var(--control-h-sm)",
                border: "1px solid var(--line-hairline)",
                background: "var(--white)",
                borderRadius: "var(--radius-pill)",
                padding: "0 14px",
                fontSize: "var(--body-3)",
              }}
            >
              <option value="pt">Português</option>
              <option value="en">English</option>
            </select>
          </label>

          {live ? (
            <PillButton onClick={stop}>End the call</PillButton>
          ) : (
            <PillButton onClick={() => void start()}>Start a session</PillButton>
          )}

          <span className={styles.mono} style={{ color: "var(--text-muted)" }}>
            {status}
            {status === "live" ? ` · ${seconds}s` : ""}
          </span>
        </div>

        {error ? (
          <p style={{ fontSize: "var(--body-3)", color: "var(--danger, #b3261e)", marginTop: "var(--space-3)" }}>{error}</p>
        ) : null}
      </div>

      {ended ? (
        <div style={{ background: "var(--surface-card)", borderRadius: "var(--radius-xl)", padding: 22 }}>
          <div className={styles.mono}>How it ended</div>
          <dl style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "6px 16px", fontSize: "var(--body-3)", marginTop: "var(--space-2)" }}>
            <dt style={{ color: "var(--text-muted)" }}>reason</dt>
            <dd>{ended.endedReason}</dd>
            <dt style={{ color: "var(--text-muted)" }}>would map to</dt>
            <dd>{ended.outcome}</dd>
            <dt style={{ color: "var(--text-muted)" }}>stopped by</dt>
            <dd>{STOPPED_BY[ended.stoppedBy] ?? ended.stoppedBy}</dd>
            {ended.transportClose ? (
              <>
                <dt style={{ color: "var(--text-muted)" }}>close</dt>
                <dd className={styles.mono}>
                  {ended.transportClose.code ?? "?"} {ended.transportClose.reason || "(no reason given)"}
                </dd>
              </>
            ) : null}
            {ended.transportError ? (
              <>
                <dt style={{ color: "var(--text-muted)" }}>error</dt>
                <dd className={styles.mono}>{ended.transportError}</dd>
              </>
            ) : null}
            <dt style={{ color: "var(--text-muted)" }}>duration</dt>
            <dd>{ended.durationSeconds}s</dd>
            <dt style={{ color: "var(--text-muted)" }}>answers</dt>
            <dd>
              {ended.liveAnswers.length === 0
                ? "none"
                : ended.liveAnswers.map((a) => `${a.criterionKey}=${a.value || "(empty)"}`).join(", ")}
            </dd>
          </dl>
          {ended.rejectedToolCalls?.length ? (
            <p
              style={{
                fontSize: "var(--body-3)",
                color: "var(--danger, #b3261e)",
                marginTop: "var(--space-3)",
                lineHeight: 1.55,
              }}
            >
              {ended.rejectedToolCalls.length} tool call
              {ended.rejectedToolCalls.length === 1 ? " was" : "s were"} dropped for malformed arguments — an answer
              was lost. {ended.rejectedToolCalls.map((r) => `${r.name}(${JSON.stringify(r.input)})`).join(" ")}
            </p>
          ) : null}
          <p style={{ fontSize: "var(--body-4, 12px)", color: "var(--text-muted)", marginTop: "var(--space-3)" }}>
            Nothing was persisted. This was a rehearsal, not an attempt.
          </p>
        </div>
      ) : null}

      <div style={{ display: "grid", gap: "var(--space-4)", gridTemplateColumns: "minmax(0, 2fr) minmax(0, 1fr)" }}>
        <div style={{ background: "var(--surface-card)", borderRadius: "var(--radius-xl)", padding: 22 }}>
          <div className={styles.mono}>Transcript</div>
          {turns.length === 0 ? (
            <p style={{ fontSize: "var(--body-3)", color: "var(--text-muted)", marginTop: "var(--space-2)" }}>
              Nothing said yet.
            </p>
          ) : (
            <ul style={{ listStyle: "none", padding: 0, margin: "var(--space-3) 0 0", display: "grid", gap: "var(--space-2)" }}>
              {turns.map((turn, i) => (
                <li key={i} style={{ fontSize: "var(--body-3)", lineHeight: 1.55 }}>
                  <span className={styles.mono} style={{ color: "var(--text-muted)", marginRight: 10 }}>
                    {turn.who === "ai" ? "agent" : "lead"}
                  </span>
                  {turn.text}
                  {turn.interrupted ? (
                    <span className={styles.mono} style={{ color: "var(--text-muted)", marginLeft: 8 }}>
                      (interrupted)
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div style={{ background: "var(--surface-card)", borderRadius: "var(--radius-xl)", padding: 22 }}>
          <div className={styles.mono}>Tool calls</div>
          {tools.length === 0 ? (
            <p style={{ fontSize: "var(--body-3)", color: "var(--text-muted)", marginTop: "var(--space-2)" }}>
              None yet.
            </p>
          ) : (
            <ul style={{ listStyle: "none", padding: 0, margin: "var(--space-3) 0 0", display: "grid", gap: "var(--space-2)" }}>
              {tools.map((tool, i) => (
                <li key={i} style={{ fontSize: "var(--body-4, 12px)", lineHeight: 1.5 }}>
                  <span className={styles.mono}>{tool.name}</span>
                  <div style={{ color: "var(--text-muted)", wordBreak: "break-word" }}>{JSON.stringify(tool.input)}</div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
