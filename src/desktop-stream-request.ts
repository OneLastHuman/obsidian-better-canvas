interface StreamRequestOptions {
  method: string;
  headers: Record<string, string>;
  body?: string;
  signal: AbortSignal;
}

interface ElectronRemote {
  getGlobal(name: "AbortController"): typeof AbortController;
  getCurrentWebContents(): {
    session: {
      fetch(url: string, options: StreamRequestOptions & { credentials: "omit" }): Promise<Response>;
    };
  };
}

/** Use the renderer's Chromium session while exposing a local browser Response. */
export async function requestStream(url: string, options: StreamRequestOptions): Promise<Response> {
  const { signal } = options;
  signal.throwIfAborted();
  const rendererWindow = typeof window === "undefined" ? undefined : window;
  const bridge: unknown = rendererWindow && "require" in rendererWindow ? rendererWindow.require : undefined;
  if (typeof bridge !== "function") {
    throw new TypeError("The Obsidian desktop runtime does not provide its Node.js module bridge.");
  }
  const electron = Reflect.apply(bridge, rendererWindow, ["electron"]) as { remote?: ElectronRemote };
  if (!electron.remote) throw new TypeError("The Obsidian desktop runtime does not provide Electron networking.");
  const remote = electron.remote;
  const MainAbortController = remote.getGlobal("AbortController");
  const mainController = new MainAbortController();
  const session = remote.getCurrentWebContents().session;
  let bodyController: ReadableStreamDefaultController<Uint8Array> | undefined;
  let finished = false;
  const cleanup = () => signal.removeEventListener("abort", onAbort);
  const onAbort = () => {
    if (finished) return;
    finished = true;
    cleanup();
    mainController.abort();
    bodyController?.error(signal.reason);
  };
  signal.addEventListener("abort", onAbort, { once: true });

  try {
    signal.throwIfAborted();
    const response = await session.fetch(url, {
      method: options.method, headers: options.headers, body: options.body, signal: mainController.signal, credentials: "omit",
    });
    signal.throwIfAborted();
    const headers = new Headers();
    // Advance explicitly: remote forEach callbacks can arrive after the method returns.
    const entries = response.headers.entries();
    for (let entry = entries.next(); !entry.done; entry = entries.next()) {
      headers.append(entry.value[0], entry.value[1]);
    }
    const remoteBody = response.body;
    let body: ReadableStream<Uint8Array> | null = null;
    if (remoteBody) {
      const reader = remoteBody.getReader();
      body = new ReadableStream<Uint8Array>({
        start(controller) { bodyController = controller; },
        async pull(controller) {
          if (finished) return;
          try {
            const chunk = await reader.read();
            if (finished) return;
            if (chunk.done) {
              finished = true;
              cleanup();
              controller.close();
            } else {
              controller.enqueue(chunk.value);
            }
          } catch (error) {
            if (finished) return;
            finished = true;
            cleanup();
            controller.error(new TypeError("Desktop streaming response failed", { cause: error }));
          }
        },
        async cancel() {
          finished = true;
          cleanup();
          let cancellation: Promise<void>;
          try {
            cancellation = reader.cancel();
          } finally {
            mainController.abort();
          }
          await cancellation;
        },
      });
    } else {
      finished = true;
      cleanup();
    }
    return new Response(body, { status: response.status, statusText: response.statusText, headers });
  } catch (error) {
    finished = true;
    cleanup();
    mainController.abort();
    signal.throwIfAborted();
    throw new TypeError("Desktop streaming request failed", { cause: error });
  }
}
