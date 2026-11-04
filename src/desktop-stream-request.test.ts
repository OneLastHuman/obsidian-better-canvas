import { createServer, type IncomingMessage, type RequestListener, type Server } from "node:http";
import { brotliCompressSync, createGzip, deflateSync, gzipSync, constants } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requestStream } from "./desktop-stream-request";

const servers: Server[] = [];
const nodeFetch = globalThis.fetch;

beforeEach(() => {
  // Only the Electron bridge is supplied here; native fetch drives the real HTTP fixtures.
  vi.stubGlobal("window", {
    require(name: string) {
      if (name !== "electron") throw new Error("Unexpected module: " + name);
      return {
        remote: {
          getGlobal: () => AbortController,
          getCurrentWebContents: () => ({ session: { fetch: nodeFetch } }),
        },
      };
    },
  });
});

// The supported ES2022 hosts predate Promise.withResolvers.
function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

async function listen(handler: RequestListener): Promise<string> {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected a TCP server address");
  return `http://127.0.0.1:${address.port}`;
}

async function readBody(request: IncomingMessage): Promise<string> {
  request.setEncoding("utf8");
  let body = "";
  for await (const chunk of request) body += String(chunk);
  return body;
}

function options(signal = new AbortController().signal) {
  return { method: "GET", headers: {}, signal };
}

afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => {
    server.closeAllConnections();
    server.close(() => resolve());
  })));
});

describe("desktop streaming requests", () => {
  it("delivers an SSE chunk before the response ends", async () => {
    const finish = deferred<() => void>();
    let ended = false;
    const url = await listen((_request, response) => {
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.write("data: first\n\n");
      finish.resolve(() => {
        ended = true;
        response.end("data: second\n\n");
      });
    });

    const response = await requestStream(url, options());
    expect(response).toBeInstanceOf(Response);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/event-stream");
    const reader = response.body!.getReader();
    const first = await reader.read();
    expect(first.value).toBeInstanceOf(Uint8Array);
    expect(new TextDecoder().decode(first.value)).toBe("data: first\n\n");
    expect(ended).toBe(false);
    (await finish.promise)();
    expect(new TextDecoder().decode((await reader.read()).value)).toBe("data: second\n\n");
    expect((await reader.read()).done).toBe(true);
  });

  it("rejects an already aborted request without contacting the server", async () => {
    let requests = 0;
    const url = await listen((_request, response) => { requests++; response.end(); });
    const controller = new AbortController();
    controller.abort();
    await expect(requestStream(url, options(controller.signal))).rejects.toMatchObject({ name: "AbortError" });
    expect(requests).toBe(0);
  });

  it("aborts while awaiting headers and closes the server socket", async () => {
    const arrived = deferred<void>();
    const closed = deferred<void>();
    const url = await listen((request) => {
      request.socket.once("close", () => closed.resolve());
      arrived.resolve();
    });
    const controller = new AbortController();
    const pending = requestStream(url, options(controller.signal));
    const rejection = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await arrived.promise;
    controller.abort();
    await rejection;
    await closed.promise;
  });

  it("aborts a response body and closes the server socket", async () => {
    const closed = deferred<void>();
    const url = await listen((request, response) => {
      request.socket.once("close", () => closed.resolve());
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.write("data: first\n\n");
    });
    const controller = new AbortController();
    const response = await requestStream(url, options(controller.signal));
    const reader = response.body!.getReader();
    await reader.read();
    const rejection = expect(reader.read()).rejects.toMatchObject({ name: "AbortError" });
    controller.abort();
    await rejection;
    await closed.promise;
  });

  it("closes an open SSE socket when the response reader is cancelled", async () => {
    const closed = deferred<void>();
    const url = await listen((request, response) => {
      request.socket.once("close", () => closed.resolve());
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.write("data: first\n\n");
    });
    const response = await requestStream(url, options());
    const reader = response.body!.getReader();
    await reader.read();
    await reader.cancel();
    await closed.promise;
    expect((await reader.read()).done).toBe(true);
  });

  it("retains HTTP error status, headers and JSON bodies", async () => {
    const url = await listen((_request, response) => {
      response.writeHead(422, { "content-type": "application/json", "x-detail": "invalid-tool" });
      response.end('{"error":"invalid tool arguments"}');
    });
    const response = await requestStream(url, options());
    expect(response.ok).toBe(false);
    expect(response.status).toBe(422);
    expect(response.headers.get("x-detail")).toBe("invalid-tool");
    expect(await response.json()).toEqual({ error: "invalid tool arguments" });
  });

  it.each([307, 308])("preserves POST through %i and removes credentials across origins", async (status) => {
    const received: { path: string; method: string | undefined; body: string; authorization: string | undefined; cookie: string | undefined }[] = [];
    const target = await listen((request, response) => {
      void readBody(request).then((body) => {
        received.push({ path: "target", method: request.method, body, authorization: request.headers.authorization, cookie: request.headers.cookie });
        response.end("accepted");
      });
    });
    const source = await listen((request, response) => {
      void readBody(request).then((body) => {
        received.push({ path: request.url!, method: request.method, body, authorization: request.headers.authorization, cookie: request.headers.cookie });
        response.writeHead(status, { location: request.url === "/start" ? "/same-origin" : target });
        response.end();
      });
    });
    const response = await requestStream(`${source}/start`, {
      method: "POST", headers: { Authorization: "Bearer test-token", Cookie: "session=test", "Content-Type": "application/json" },
      body: '{"tool":"search"}', signal: new AbortController().signal,
    });
    expect(await response.text()).toBe("accepted");
    expect(received).toEqual([
      { path: "/start", method: "POST", body: '{"tool":"search"}', authorization: "Bearer test-token", cookie: "session=test" },
      { path: "/same-origin", method: "POST", body: '{"tool":"search"}', authorization: "Bearer test-token", cookie: "session=test" },
      { path: "target", method: "POST", body: '{"tool":"search"}', authorization: undefined, cookie: undefined },
    ]);
  });

  it.each([301, 302, 303])("changes POST to GET for %i and removes body headers", async (status) => {
    const received = deferred<{ method: string | undefined; body: string; contentType: string | undefined; contentLength: string | undefined }>();
    const url = await listen((request, response) => {
      if (request.url === "/start") {
        response.writeHead(status, { location: "/final" });
        response.end();
      } else {
        void readBody(request).then((body) => {
          received.resolve({ method: request.method, body, contentType: request.headers["content-type"], contentLength: request.headers["content-length"] });
          response.end("done");
        });
      }
    });
    const response = await requestStream(`${url}/start`, {
      method: "POST", headers: { "Content-Type": "text/plain", "Content-Length": "7" }, body: "payload", signal: new AbortController().signal,
    });
    expect(await response.text()).toBe("done");
    expect(await received.promise).toEqual({ method: "GET", body: "", contentType: undefined, contentLength: undefined });
  });

  it("rejects a redirect loop after twenty redirects", async () => {
    let requests = 0;
    const url = await listen((_request, response) => {
      requests++;
      response.writeHead(302, { location: "/loop" });
      response.end();
    });
    await expect(requestStream(url, options())).rejects.toBeInstanceOf(TypeError);
    expect(requests).toBe(21);
  });

  it.each([
    ["gzip", gzipSync], ["deflate", deflateSync], ["br", brotliCompressSync],
  ] as const)("decodes %s responses while preserving HTTP error bodies", async (encoding, compress) => {
    const url = await listen((_request, response) => {
      const compressed = compress("service temporarily unavailable");
      response.writeHead(503, { "content-encoding": encoding, "content-length": String(compressed.length) });
      response.end(compressed);
    });
    const response = await requestStream(url, options());
    expect(response.status).toBe(503);
    expect(await response.text()).toBe("service temporarily unavailable");
  });

  it("decodes compressed SSE chunks before the compressed response ends", async () => {
    const finish = deferred<() => void>();
    const url = await listen((_request, response) => {
      response.writeHead(200, { "content-type": "text/event-stream", "content-encoding": "gzip" });
      const gzip = createGzip();
      gzip.pipe(response);
      gzip.write("data: first\n\n");
      gzip.flush(constants.Z_SYNC_FLUSH);
      finish.resolve(() => gzip.end("data: last\n\n"));
    });
    const response = await requestStream(url, options());
    const reader = response.body!.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toBe("data: first\n\n");
    (await finish.promise)();
    expect(new TextDecoder().decode((await reader.read()).value)).toBe("data: last\n\n");
    expect((await reader.read()).done).toBe(true);
  });

  it("rejects connection failures as TypeError for the AI fallback", async () => {
    const url = await listen((request) => request.socket.destroy());
    await expect(requestStream(url, options())).rejects.toBeInstanceOf(TypeError);
  });

  it("rejects a body that is truncated after headers", async () => {
    const truncate = deferred<() => void>();
    const url = await listen((request, response) => {
      response.writeHead(200, { "content-length": "100" });
      response.write("first");
      truncate.resolve(() => request.socket.destroy());
    });
    const response = await requestStream(url, options());
    const reader = response.body!.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toBe("first");
    const rejection = expect(reader.read()).rejects.toBeInstanceOf(TypeError);
    (await truncate.promise)();
    await rejection;
  });

  it("returns headers and a null body for HEAD requests", async () => {
    const url = await listen((_request, response) => {
      response.writeHead(200, { "content-length": "25", "x-detail": "metadata" });
      response.end();
    });
    const response = await requestStream(url, { ...options(), method: "HEAD" });
    expect(response.body).toBeNull();
    expect(response.headers.get("content-length")).toBe("25");
    expect(response.headers.get("x-detail")).toBe("metadata");
    expect(await response.text()).toBe("");
  });

  it("does not import native Node modules when a renderer lacks its bridge", async () => {
    vi.stubGlobal("window", {});
    await expect(requestStream("http://127.0.0.1:1", options())).rejects.toThrow(/module bridge/);
  });

  it.each([204, 205, 304])("returns a null body for status %i", async (status) => {
    const url = await listen((_request, response) => { response.writeHead(status); response.end(); });
    const response = await requestStream(url, options());
    expect(response.status).toBe(status);
    expect(response.body).toBeNull();
    expect(await response.text()).toBe("");
  });
});
