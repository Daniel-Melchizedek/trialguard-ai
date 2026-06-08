// Playwright MCP HTTP client — loaded in service worker via importScripts('mcpClient.js')
// Uses MCP Streamable HTTP transport (2025-03-26): requires initialize handshake before tool calls.
const MCPClient = (() => {
  const ROOT     = "http://localhost:3333";
  const ENDPOINT = "http://localhost:3333/mcp";
  let _id        = 1;
  let _sessionId = null;
  let _initDone  = false;

  function buildHeaders() {
    const h = {
      "Content-Type": "application/json",
      "Accept": "application/json, text/event-stream"
    };
    if (_sessionId) h["Mcp-Session-Id"] = _sessionId;
    return h;
  }

  // Combine a step-level timeout with an optional external abort signal
  function makeSignal(timeoutMs, abortSignal) {
    const timeout = AbortSignal.timeout(timeoutMs);
    if (!abortSignal) return timeout;
    // AbortSignal.any() is Chrome/Edge 116+ — use a manual combiner as fallback
    if (typeof AbortSignal.any === "function") return AbortSignal.any([timeout, abortSignal]);
    const ac = new AbortController();
    const abort = () => ac.abort();
    if (timeout.aborted || abortSignal.aborted) { ac.abort(); return ac.signal; }
    timeout.addEventListener("abort", abort, { once: true });
    abortSignal.addEventListener("abort", abort, { once: true });
    return ac.signal;
  }

  async function post(body, timeoutMs = 30000, abortSignal = null) {
    const r = await fetch(ENDPOINT, {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify(body),
      signal: makeSignal(timeoutMs, abortSignal)
    });
    const sid = r.headers.get("Mcp-Session-Id");
    if (sid) _sessionId = sid;
    return r;
  }

  async function rpc(method, params, timeoutMs = 30000, abortSignal = null) {
    const r = await post({ jsonrpc: "2.0", id: _id++, method, params }, timeoutMs, abortSignal);
    if (!r.ok) throw new Error(`MCP ${method} failed: HTTP ${r.status}`);

    const ct = r.headers.get("Content-Type") || "";
    if (ct.includes("text/event-stream")) return _readSSE(r.body, abortSignal);

    const data = await r.json();
    if (data.error) throw new Error(data.error.message ?? JSON.stringify(data.error));
    return data.result;
  }

  async function notify(method, params = {}) {
    await post({ jsonrpc: "2.0", method, params }, 5000).catch(() => {});
  }

  async function ensureInit(abortSignal = null) {
    if (_initDone) return;
    await rpc("initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "TrialGuard", version: "1.0.0" }
    }, 10000, abortSignal);
    await notify("notifications/initialized");
    _initDone = true;
  }

  async function _readSSE(stream, abortSignal = null) {
    const reader = stream.getReader();
    const dec = new TextDecoder();
    let buf = "";
    let last = null;

    // If aborted externally, release the reader
    const onAbort = () => reader.cancel().catch(() => {});
    abortSignal?.addEventListener("abort", onAbort, { once: true });

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop();
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const obj = JSON.parse(line.slice(6));
            if (obj.result != null) last = obj.result;
            if (obj.error) throw new Error(obj.error.message ?? JSON.stringify(obj.error));
          } catch (e) {
            if (e.message && !e.message.startsWith("JSON")) throw e;
          }
        }
      }
    } finally {
      abortSignal?.removeEventListener("abort", onAbort);
      reader.releaseLock();
    }
    return last;
  }

  return {
    async isAvailable() {
      try {
        const r = await fetch(ROOT, { signal: AbortSignal.timeout(1500) });
        return r.status < 500;
      } catch {
        return false;
      }
    },

    async listTools() {
      await ensureInit();
      const result = await rpc("tools/list", {}, 5000);
      return result?.tools ?? [];
    },

    async callTool(toolName, toolInput, abortSignal = null) {
      await ensureInit(abortSignal);
      return rpc("tools/call", { name: toolName, arguments: toolInput }, 30000, abortSignal);
    }
  };
})();
