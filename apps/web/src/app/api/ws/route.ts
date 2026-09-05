import { experimental_upgradeWebSocket, type WebSocketData } from "@vercel/functions";

/**
 * Spike (voice-bridge task 2.2) — does the Vercel WebSocket beta perform the
 * upgrade from a Next 16 route handler on this project, and how long does the
 * connection survive?
 *
 * Next's own documentation says WebSockets do not work in route handlers; this
 * is the platform escape hatch, and the whole shape of the change depends on
 * whether it works here. Throwaway: deleted once `/api/media` exists.
 */

export async function GET() {
  const openedAt = Date.now();
  return experimental_upgradeWebSocket((ws) => {
    ws.send(JSON.stringify({ hello: "solarwave", openedAt }));

    // A heartbeat, so a connection that dies silently is visible as a gap
    // rather than as a socket that merely went quiet.
    const beat = setInterval(() => {
      ws.send(JSON.stringify({ tick: Math.round((Date.now() - openedAt) / 1000) }));
    }, 5000);

    ws.on("message", (data: WebSocketData) => {
      ws.send(JSON.stringify({ echo: String(data), atSeconds: Math.round((Date.now() - openedAt) / 1000) }));
    });

    ws.on("close", () => clearInterval(beat));
  });
}
