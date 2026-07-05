/**
 * Node adapter for the worker handler — lets the same fetch-based server run
 * as a plain container (Dokploy/Docker) instead of Cloudflare Workers.
 * Serves ui/dist statically with an SPA fallback; /api/* is delegated to the
 * exact same handler the Worker uses.
 */
import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import worker from "./index.js";

const PORT = Number(process.env.PORT ?? 8080);
const DIST = resolve(fileURLToPath(new URL("../ui/dist", import.meta.url)));

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

function toFetchHeaders(req: IncomingMessage): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (typeof value === "string") headers.set(key, value);
    else if (Array.isArray(value)) headers.set(key, value.join(", "));
  }
  // The worker rate-limits on CF-Connecting-IP; outside Cloudflare, fall back
  // to the proxy header or the socket address so limits stay per-visitor.
  if (!headers.has("CF-Connecting-IP")) {
    const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
    headers.set(
      "CF-Connecting-IP",
      forwarded || req.socket.remoteAddress || "unknown"
    );
  }
  return headers;
}

async function handleApi(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL
): Promise<void> {
  const method = req.method ?? "GET";
  const hasBody = method !== "GET" && method !== "HEAD";
  const request = new Request(url, {
    method,
    headers: toFetchHeaders(req),
    body: hasBody ? (req as unknown as ReadableStream) : undefined,
    // Node's fetch primitives require half-duplex for streamed request bodies
    ...(hasBody ? { duplex: "half" } : {}),
  } as RequestInit);

  const response = await worker.fetch(
    request,
    process.env as Record<string, string | undefined>
  );
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(Buffer.from(await response.arrayBuffer()));
}

async function handleStatic(
  res: ServerResponse,
  pathname: string
): Promise<void> {
  let relative = normalize(pathname).replace(/^[/\\]+/, "");
  if (relative === "" || relative === ".") relative = "index.html";
  let file = resolve(join(DIST, relative));
  if (!file.startsWith(DIST)) {
    res.writeHead(403, { "Content-Type": "text/plain" });
    res.end("forbidden");
    return;
  }
  try {
    const info = await stat(file);
    if (info.isDirectory()) file = join(file, "index.html");
    await stat(file);
  } catch {
    file = join(DIST, "index.html"); // SPA fallback
  }
  const data = await readFile(file);
  res.writeHead(200, {
    "Content-Type": MIME[extname(file)] ?? "application/octet-stream",
  });
  res.end(data);
}

createServer(async (req, res) => {
  try {
    const url = new URL(
      req.url ?? "/",
      `http://${req.headers.host ?? "localhost"}`
    );
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
    } else {
      await handleStatic(res, url.pathname);
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "internal error";
    res.writeHead(500, { "Content-Type": "text/plain" });
    res.end(message);
  }
}).listen(PORT, () => {
  console.log(`wa-lead-extractor listening on :${PORT}`);
});
