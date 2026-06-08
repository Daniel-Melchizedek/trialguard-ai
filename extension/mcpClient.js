// Playwright MCP HTTP client — loaded in service worker via importScripts('mcpClient.js')
const MCPClient = (() => {
  const BASE = "http://localhost:3333";
  let _id = 1;

  async function rpc(method, params, timeoutMs = 30000) {
    const r = await fetch(BASE, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream"
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: _id++, method, params }),
      signal: AbortSignal.timeout(timeoutMs)
    });
    if (!r.ok) throw new Error(`MCP ${method} failed: HTTP ${r.status}`);

    const ct = r.headers.get("Content-Type") || "";
    if (ct.includes("text/event-stream")) return _readSSE(r.body);

    const data = await r.json();
    if (data.error) throw new Error(data.error.message ?? JSON.stringify(data.error));
    return data.result;
  }

  async function _readSSE(stream) {
    const reader = stream.getReader();
    const dec = new TextDecoder();
    let buf = "";
    let last = null;
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
      reader.releaseLock();
    }
    return last;
  }

  return {
    async isAvailable() {
      try {
        const r = await fetch(BASE, { signal: AbortSignal.timeout(1500) });
        return r.status < 500;
      } catch {
        return false;
      }
    },

    async listTools() {
      const result = await rpc("tools/list", {}, 5000);
      return result?.tools ?? [];
    },

    async callTool(toolName, toolInput) {
      return rpc("tools/call", { name: toolName, arguments: toolInput });
    }
  };
})();
