#!/usr/bin/env node
/**
 * Opens an ngrok tunnel to `vercel dev` and writes its URL into `.env.local`.
 *
 * The free ngrok plan on this account cannot pin a static domain — every
 * `--url` with a subdomain is rejected as a paid "custom subdomain", on
 * `.ngrok-free.dev`, `.ngrok-free.app` and `.ngrok.io` alike. So the public
 * host changes on every restart, and the one place that has to follow it is
 * `VOICE_PUBLIC_BASE_URL`: dispatch builds the Twilio instruction, status
 * callback and media stream URLs from it per call, so there is no webhook
 * configured in the Twilio console to keep in sync.
 *
 * This script closes that loop, so a restart costs nothing.
 *
 *   pnpm tunnel            tunnels port 3999
 *   pnpm tunnel 3000       tunnels another port
 *
 * Leave it running beside `vercel dev`. `next dev` will not do: it does not
 * perform the WebSocket upgrade the media bridge needs.
 */

import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ENV_FILE = resolve(ROOT, "apps/web/.env.local");
const VARIABLE = "VOICE_PUBLIC_BASE_URL";
const NGROK_API = "http://127.0.0.1:4040/api/tunnels";
const PORT = process.argv[2] ?? "3999";

/** The https tunnel ngrok is currently serving, or null while it has none. */
async function publicUrl() {
  try {
    const response = await fetch(NGROK_API, { signal: AbortSignal.timeout(2000) });
    if (!response.ok) return null;
    const { tunnels = [] } = await response.json();
    return tunnels.find((t) => t.public_url?.startsWith("https://"))?.public_url ?? null;
  } catch {
    return null;
  }
}

async function waitForUrl(attempts = 30) {
  for (let i = 0; i < attempts; i += 1) {
    const url = await publicUrl();
    if (url) return url;
    await new Promise((r) => setTimeout(r, 500));
  }
  return null;
}

/**
 * Rewrites one variable, leaving every other line byte-for-byte alone.
 *
 * A missing `.env.local` is an error rather than something to create: writing
 * a one-line env file over a developer's missing configuration would look like
 * it worked and then fail much later, somewhere unrelated.
 */
function writeVariable(url) {
  let contents;
  try {
    contents = readFileSync(ENV_FILE, "utf8");
  } catch {
    console.error(`\n  ${ENV_FILE} does not exist. Copy apps/web/.env.example first.\n`);
    process.exit(1);
  }

  const line = `${VARIABLE}=${url}`;
  const pattern = new RegExp(`^${VARIABLE}=.*$`, "m");
  const next = pattern.test(contents)
    ? contents.replace(pattern, line)
    : `${contents.replace(/\n*$/, "\n")}\n# Written by \`pnpm tunnel\`.\n${line}\n`;

  if (next === contents) return false;
  writeFileSync(ENV_FILE, next);
  return true;
}

async function main() {
  const existing = await publicUrl();
  if (existing) {
    console.log(`  ngrok is already running: ${existing}`);
    writeVariable(existing);
    console.log(`  ${VARIABLE} written to apps/web/.env.local`);
    console.log("  Leaving the existing tunnel alone. Stop it yourself if you want a new one.");
    return;
  }

  console.log(`  starting ngrok on port ${PORT}...`);
  const ngrok = spawn("ngrok", ["http", PORT, "--log", "stdout"], {
    stdio: ["ignore", "pipe", "inherit"],
    shell: process.platform === "win32",
  });

  let failed = "";
  ngrok.stdout.on("data", (chunk) => {
    const text = String(chunk);
    // ngrok logs its own errors at info level on stdout; surface only those.
    if (text.includes("ERR_NGROK") || text.includes("lvl=eror")) failed += text;
  });
  ngrok.on("exit", (code) => {
    if (code !== 0) {
      console.error(failed || `  ngrok exited with code ${code}`);
      process.exit(code ?? 1);
    }
  });

  const url = await waitForUrl();
  if (!url) {
    ngrok.kill();
    console.error(failed || "  ngrok did not report a tunnel. Is it installed and authenticated?");
    process.exit(1);
  }

  writeVariable(url);
  console.log(`
  tunnel   ${url}
  target   http://localhost:${PORT}   (run \`vercel dev --listen ${PORT}\` beside this)
  inspect  http://127.0.0.1:4040

  ${VARIABLE} written to apps/web/.env.local.
  Ctrl-C stops the tunnel; the variable stays behind and goes stale.
`);

  const stop = () => {
    ngrok.kill();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

await main();
