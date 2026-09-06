/**
 * The call instructions Twilio fetches when the callee answers.
 *
 * `<Connect><Stream>` is the bidirectional form: Twilio opens a WebSocket to
 * us and expects audio back down the same socket. The one-way `<Start><Stream>`
 * would give us the lead's voice and no way to answer.
 *
 * Pure string building, so it is testable without a telephone and without a
 * server.
 */

/** XML escaping for the five predefined entities. Attribute values included. */
function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export type ConnectStreamInput = {
  /** Origin Twilio reaches, no trailing slash. */
  publicBaseUrl: string;
  /** Signed and bound to this call; the bridge refuses a stream without it. */
  token: string;
};

/**
 * The token travels as a `<Parameter>` rather than in the query string.
 *
 * Twilio echoes stream parameters in the `start` frame, so the bridge reads it
 * from the protocol rather than from a URL that would also land in Twilio's
 * request logs and in any proxy in between.
 */
export function connectStreamTwiml({ publicBaseUrl, token }: ConnectStreamInput): string {
  const wsUrl = `${publicBaseUrl.replace(/^http/, "ws").replace(/\/+$/, "")}/api/media`;
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    "<Response>",
    "  <Connect>",
    `    <Stream url="${escapeXml(wsUrl)}">`,
    `      <Parameter name="token" value="${escapeXml(token)}" />`,
    "    </Stream>",
    "  </Connect>",
    "</Response>",
  ].join("\n");
}

/**
 * Ends the call immediately, saying nothing.
 *
 * Used when the instructions are fetched for a call we cannot serve — an
 * attempt that no longer exists, or a configuration that vanished between
 * dialling and answering. Hanging up in silence is better than a spoken error:
 * the person who answered is a lead, not an operator.
 */
export function hangUpTwiml(): string {
  return ['<?xml version="1.0" encoding="UTF-8"?>', "<Response>", "  <Hangup />", "</Response>"].join("\n");
}
