import { describe, expect, it } from "vitest";
import { clearFrame, mediaFrame, parseTwilioFrame } from "./mediaStream";

const json = (value: unknown) => JSON.stringify(value);

describe("parseTwilioFrame", () => {
  it("reads a start frame with its call SID and stream token", () => {
    const frame = parseTwilioFrame(
      json({
        event: "start",
        streamSid: "MZ1",
        start: { callSid: "CA1", streamSid: "MZ1", customParameters: { token: "CA1.123.sig" } },
      }),
    );
    expect(frame).toEqual({
      event: "start",
      start: { callSid: "CA1", streamSid: "MZ1", token: "CA1.123.sig" },
    });
  });

  it("falls back to the envelope's streamSid", () => {
    const frame = parseTwilioFrame(json({ event: "start", streamSid: "MZ1", start: { callSid: "CA1" } }));
    expect(frame).toMatchObject({ event: "start", start: { streamSid: "MZ1" } });
  });

  it("reports a missing token rather than inventing one", () => {
    const frame = parseTwilioFrame(json({ event: "start", start: { callSid: "CA1", streamSid: "MZ1" } }));
    expect(frame).toMatchObject({ event: "start", start: { token: null } });
  });

  it("refuses a start with no call SID", () => {
    // Unauthenticatable: there is nothing to bind a token to, and opening a
    // model session on it would be opening one on an unverifiable stream.
    const frame = parseTwilioFrame(json({ event: "start", start: { streamSid: "MZ1" } }));
    expect(frame?.event).toBe("unknown");
  });

  it("reads a media frame", () => {
    expect(parseTwilioFrame(json({ event: "media", streamSid: "MZ1", media: { payload: "AAAA" } }))).toEqual({
      event: "media",
      streamSid: "MZ1",
      payload: "AAAA",
    });
  });

  it("refuses a media frame with no payload", () => {
    expect(parseTwilioFrame(json({ event: "media", streamSid: "MZ1", media: {} }))?.event).toBe("unknown");
    expect(parseTwilioFrame(json({ event: "media", streamSid: "MZ1" }))?.event).toBe("unknown");
  });

  it("reads the frames that carry no data", () => {
    expect(parseTwilioFrame(json({ event: "connected" }))).toEqual({ event: "connected" });
    expect(parseTwilioFrame(json({ event: "stop", streamSid: "MZ1" }))).toEqual({ event: "stop", streamSid: "MZ1" });
    expect(parseTwilioFrame(json({ event: "mark", streamSid: "MZ1" }))).toEqual({ event: "mark", streamSid: "MZ1" });
  });

  it("keeps an unknown event instead of throwing", () => {
    // Twilio may add events; a bridge that crashes on one drops a live call.
    const frame = parseTwilioFrame(json({ event: "dtmf", streamSid: "MZ1" }));
    expect(frame).toEqual({ event: "unknown", raw: json({ event: "dtmf", streamSid: "MZ1" }) });
  });

  it("returns null for anything that is not JSON", () => {
    expect(parseTwilioFrame("not json")).toBeNull();
    expect(parseTwilioFrame("")).toBeNull();
  });

  it("treats an empty string field as absent", () => {
    expect(parseTwilioFrame(json({ event: "start", start: { callSid: "", streamSid: "MZ1" } }))?.event).toBe("unknown");
  });
});

describe("outbound frames", () => {
  it("wraps agent audio for the stream it belongs to", () => {
    expect(JSON.parse(mediaFrame("MZ1", "AAAA"))).toEqual({
      event: "media",
      streamSid: "MZ1",
      media: { payload: "AAAA" },
    });
  });

  it("builds the clear frame barge-in depends on", () => {
    // Without the streamSid Twilio ignores it, and the agent keeps talking over
    // the lead for as long as its buffer lasts.
    expect(JSON.parse(clearFrame("MZ1"))).toEqual({ event: "clear", streamSid: "MZ1" });
  });

  it("round-trips through the parser", () => {
    const parsed = parseTwilioFrame(mediaFrame("MZ1", "AAAA"));
    expect(parsed).toEqual({ event: "media", streamSid: "MZ1", payload: "AAAA" });
  });
});
