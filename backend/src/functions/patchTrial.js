const { app } = require("@azure/functions");
const { patchCancellationStatus } = require("../utils/cosmosClient");

const ALLOWED_FIELDS = new Set([
  "cancellationStatus",
  "cancellationPlan",
  "cancellationStartedAt",
  "cancellationCompletedAt",
  "cancellationError"
]);

app.http("patchTrial", {
  methods: ["PATCH", "OPTIONS"],
  authLevel: "anonymous",
  route: "patch-trial",
  handler: async (request, context) => {
    if (request.method === "OPTIONS") {
      return { status: 200, headers: corsHeaders() };
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return jsonResponse(400, { error: "Invalid JSON body" });
    }

    const { id, userEmail, ...rest } = body;
    if (!id || !userEmail) {
      return jsonResponse(400, { error: "id and userEmail are required" });
    }

    const fields = Object.fromEntries(
      Object.entries(rest).filter(([k]) => ALLOWED_FIELDS.has(k))
    );

    if (!Object.keys(fields).length) {
      return jsonResponse(400, { error: "No valid fields to update" });
    }

    try {
      await patchCancellationStatus(id, userEmail, fields);
      context.log(`[TrialGuard] Patched trial ${id}: ${JSON.stringify(fields)}`);
    } catch (err) {
      context.error("[TrialGuard] patchTrial error:", err.message);
      return jsonResponse(500, { error: "Failed to patch trial" });
    }

    return jsonResponse(200, { success: true });
  }
});

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "PATCH, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, x-functions-key"
  };
}

function jsonResponse(status, body) {
  return {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders() },
    body: JSON.stringify(body)
  };
}
