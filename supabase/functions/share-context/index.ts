import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

interface ShareLinkRow {
  id: string;
  token: string;
  context_json: Record<string, unknown>;
  expires_at: string | null;
  max_access_count: number | null;
  access_count: number;
}

Deno.serve(async (req: Request) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Access-Control-Max-Age": "86400",
      },
    });
  }

  if (req.method !== "GET") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  // Extract token from URL path: /share-context?token=xxx or path-based /share-context/<token>
  const url = new URL(req.url);
  let token = url.searchParams.get("token");

  // Also support path-based token: /share-context/<token>
  if (!token) {
    const pathParts = url.pathname.replace(/\/+$/, "").split("/");
    token = pathParts[pathParts.length - 1] || null;
  }

  if (!token) {
    return jsonResponse({ error: "Missing token parameter" }, 400);
  }

  // Validate token format (hex string, 48 chars)
  if (!/^[a-f0-9]{48}$/.test(token)) {
    return jsonResponse({ error: "Invalid token format" }, 400);
  }

  try {
    // Look up the share link using service role (bypasses RLS)
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/context_share_links?token=eq.${token}&select=id,token,context_json,expires_at,max_access_count,access_count`,
      {
        headers: {
          apikey: SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );

    if (!res.ok) {
      console.error("Supabase REST error:", res.status, await res.text());
      return jsonResponse({ error: "Internal server error" }, 500);
    }

    const rows = await res.json() as ShareLinkRow[];
    if (!rows || rows.length === 0) {
      return jsonResponse({ error: "Link not found" }, 404);
    }

    const link = rows[0];

    // Check expiry
    if (link.expires_at && new Date(link.expires_at) < new Date()) {
      return jsonResponse({ error: "This link has expired" }, 410);
    }

    // Check access count
    if (link.max_access_count != null && link.access_count >= link.max_access_count) {
      return jsonResponse({ error: "This link has reached its access limit" }, 410);
    }

    // Increment access count (fire and forget)
    incrementAccessCount(link.id, link.access_count).catch(() => {});

    // Return the context JSON
    return jsonResponse(link.context_json, 200);
  } catch (err) {
    console.error("Error serving shared context:", err);
    return jsonResponse({ error: "Internal server error" }, 500);
  }
});

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-store",
    },
  });
}

async function incrementAccessCount(id: string, currentCount: number): Promise<void> {
  await fetch(
    `${SUPABASE_URL}/rest/v1/context_share_links?id=eq.${id}`,
    {
      method: "PATCH",
      headers: {
        apikey: SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        access_count: currentCount + 1,
        last_accessed_at: new Date().toISOString(),
      }),
    }
  );
}
