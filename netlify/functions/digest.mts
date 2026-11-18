import type { Config, Context } from "@netlify/functions";
import { createHash } from "node:crypto";

/**
 * Daily digest scheduler — self-calls POST /api/email/digest with the same
 * bearer token the server derives from APP_PASSWORD. Runs once a day; the
 * server's own cadence logic decides whether anything is due.
 */
export default async (req: Request, context: Context) => {
  const base = process.env.URL ?? process.env.APP_URL ?? "";
  const pw = process.env.APP_PASSWORD ?? "";
  if (!base) return new Response("skipped: no URL env", { status: 200 });
  const token = pw ? createHash("sha256").update(pw + "|ps-tracker").digest("hex") : "";
  try {
    const res = await fetch(`${base}/api/email/digest`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ link: base }),
    });
    const body = await res.text();
    console.log(`digest run: ${res.status} ${body.slice(0, 200)}`);
    return new Response(body.slice(0, 400), { status: 200 });
  } catch (error) {
    console.log("digest run failed:", String(error));
    return new Response("digest failed", { status: 200 });
  }
};

export const config: Config = {
  schedule: "@daily",
};
