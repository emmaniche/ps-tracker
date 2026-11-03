import { parseTriggerDelivery } from "@neon/functions/triggers";
import { createHash } from "node:crypto";

// Relay a cron trigger into the app API. The API stays closed to the public
// (shared password); this function authenticates with the same derived token.
const API = (process.env.PUBLIC_API_URL || "").replace(/\/$/, "");
const PASSWORD = process.env.APP_PASSWORD || "";
const TOKEN = PASSWORD ? createHash("sha256").update(PASSWORD + "|ps-tracker").digest("hex") : "";

export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });

    const parsed = await parseTriggerDelivery(request);
    if (!parsed.ok) {
      return new Response(parsed.error, { status: parsed.error === "invalid_body" ? 400 : 401 });
    }

    if (!API) return Response.json({ ok: false, error: "PUBLIC_API_URL is not configured" }, { status: 503 });

    try {
      const r = await fetch(API + "/api/email/digest", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + TOKEN },
        body: JSON.stringify({ link: API }),
      });
      const body = await r.text();
      console.log("digest relay", parsed.invocation.invocationId, r.status);
      return new Response(body, {
        status: r.status,
        headers: { "Content-Type": r.headers.get("content-type") || "text/plain" },
      });
    } catch (e) {
      console.error("digest relay failed", e);
      return Response.json({ ok: false, error: String(e) }, { status: 502 });
    }
  },
};
