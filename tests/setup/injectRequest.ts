/**
 * tests/setup/injectRequest.ts
 *
 * A zero-socket HTTP injection helper.  It sends a synthetic HTTP/1.1 request
 * directly into an Express (or any Node http.Handler) app by piping data
 * through a pair of in-process Duplex streams — no TCP socket is ever opened.
 *
 * This sidesteps `EPERM: operation not permitted` errors that occur in
 * sandboxed / network-restricted test environments.
 *
 * Usage:
 *   import { injectRequest } from "../setup/injectRequest.ts";
 *   const { status, body } = await injectRequest(app, "POST", "/api/foo", {
 *     body: { hello: "world" },
 *     token: "Bearer <jwt>",
 *   });
 */

import { IncomingMessage, ServerResponse } from "node:http";
import { Duplex, PassThrough } from "node:stream";
import type { Express } from "express";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface InjectOptions {
  body?: unknown;
  token?: string;
  headers?: Record<string, string>;
}

export interface InjectResult {
  status: number;
  headers: Record<string, string | string[]>;
  body: unknown;
  text: string;
}

// ─── Core helper ────────────────────────────────────────────────────────────

/**
 * Inject a synthetic HTTP request into `app` and return the response.
 * No network socket is opened — all I/O is in-process via Node streams.
 */
export function injectRequest(
  app: Express,
  method: string,
  path: string,
  opts: InjectOptions = {}
): Promise<InjectResult> {
  return new Promise((resolve, reject) => {
    const bodyStr = opts.body !== undefined ? JSON.stringify(opts.body) : "";
    const bodyBuf = Buffer.from(bodyStr, "utf8");

    // ── Build synthetic IncomingMessage ────────────────────────────────────
    // IncomingMessage extends Readable; we build it from a PassThrough so we
    // can push the body bytes into it after construction.
    const reqStream = new PassThrough();
    const req = new IncomingMessage(new Duplex() as any);

    req.method = method.toUpperCase();
    req.url = path;
    req.headers = {
      "content-type": "application/json",
      "content-length": String(bodyBuf.byteLength),
      ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
      ...(opts.headers
        ? Object.fromEntries(Object.entries(opts.headers).map(([k, v]) => [k.toLowerCase(), v]))
        : {}),
    };

    // Pipe body bytes through the PassThrough and attach to req
    // We make req readable by overriding its _read / push internals
    // using the standard Readable push API.
    (req as any).push = reqStream.push.bind(reqStream);
    req.pipe = reqStream.pipe.bind(reqStream);

    // Simpler: monkey-patch the stream methods Express actually uses
    // (IncomingMessage.read, on 'data', on 'end').
    const dataListeners: Array<(chunk: Buffer) => void> = [];
    const endListeners: Array<() => void> = [];

    (req as any).on = function (event: string, listener: (...args: any[]) => void) {
      if (event === "data") dataListeners.push(listener as any);
      else if (event === "end") endListeners.push(listener as any);
      else IncomingMessage.prototype.on.call(this, event, listener);
      return this;
    };

    // Emit body + end immediately after Express has had a chance to register
    // its listeners (next tick is sufficient because route matching is sync).
    process.nextTick(() => {
      if (bodyBuf.byteLength > 0) {
        dataListeners.forEach((fn) => fn(bodyBuf));
      }
      endListeners.forEach((fn) => fn());
    });

    // ── Build synthetic ServerResponse ─────────────────────────────────────
    const chunks: Buffer[] = [];
    const responseHeaders: Record<string, string | string[]> = {};
    let statusCode = 200;
    let resolved = false;

    // ServerResponse requires a socket; give it a minimal Duplex.
    const fakeSocket = new Duplex({
      read() {},
      write(_chunk, _enc, cb) { cb(); },
    });

    const res = new ServerResponse(req as any);
    // Attach a writable output sink so res.write / res.end work
    (res as any).socket = fakeSocket;
    (res as any).connection = fakeSocket;

    const originalWrite = res.write.bind(res);
    const originalEnd = res.end.bind(res);

    // Capture write calls
    (res as any).write = function (chunk: any, ...rest: any[]) {
      if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      return originalWrite(chunk, ...rest);
    };

    // Capture end (final chunk) and resolve
    (res as any).end = function (chunk?: any, ...rest: any[]) {
      if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      if (!resolved) {
        resolved = true;
        const text = Buffer.concat(chunks).toString("utf8");
        let body: unknown;
        try { body = JSON.parse(text); } catch { body = text; }
        resolve({ status: res.statusCode ?? statusCode, headers: responseHeaders, body, text });
      }
      return originalEnd(chunk, ...rest);
    };

    // Intercept setHeader / writeHead for header capture
    const originalSetHeader = res.setHeader.bind(res);
    (res as any).setHeader = function (name: string, value: string | string[]) {
      responseHeaders[name.toLowerCase()] = value;
      return originalSetHeader(name, value);
    };

    const originalWriteHead = res.writeHead.bind(res);
    (res as any).writeHead = function (code: number, ...rest: any[]) {
      statusCode = code;
      res.statusCode = code;
      return originalWriteHead(code, ...rest);
    };

    // ── Dispatch into Express ──────────────────────────────────────────────
    try {
      (app as any)(req, res, (err?: Error) => {
        if (err) reject(err);
        else if (!resolved) {
          resolved = true;
          resolve({ status: 404, headers: {}, body: { error: "Not found" }, text: "" });
        }
      });
    } catch (err) {
      reject(err);
    }
  });
}
