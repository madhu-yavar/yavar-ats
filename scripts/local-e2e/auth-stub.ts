// Minimal GoTrue-compatible auth stub for local e2e (HS256 path).
// supabase-js client: signInWithPassword -> POST /auth/v1/token?grant_type=password
// server getClaims(): HS256 JWT -> falls back to getUser -> GET /auth/v1/user
const PORT = 54999;
const SECRET = new TextEncoder().encode("e2e-only-hs256-secret-0123456789abcdef");

// id, email, password, org-scoped seeds reference these UUIDs
const USERS = [
  { id: "6a6a0000-0000-4000-8000-00000000d001", email: "madhu@demo.com", password: "demo1234" },
  { id: "6a6a0000-0000-4000-8000-00000000d002", email: "hr@yavar.ai", password: "demo1234" },
  { id: "6a6a0000-0000-4000-8000-00000000d003", email: "recruiter@demo.com", password: "demo1234" },
  { id: "6a6a0000-0000-4000-8000-00000000d004", email: "dh@demo.com", password: "demo1234" },
  { id: "6a6a0000-0000-4000-8000-00000000d005", email: "hm@demo.com", password: "demo1234" },
  { id: "6a6a0000-0000-4000-8000-00000000d006", email: "owner@newdemo.com", password: "demo1234" },
  {
    id: "5e2e0000-0000-4000-8000-00000000e2e1",
    email: "e2e-owner@atsiq-e2e.local",
    password: "E2e-Test-Passw0rd!",
  },
];

const b64u = (data: Uint8Array | string) =>
  Buffer.from(data).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function hs256jwt(payload: Record<string, unknown>): Promise<string> {
  const head = b64u(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64u(JSON.stringify(payload));
  const key = await crypto.subtle.importKey(
    "raw",
    SECRET,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${head}.${body}`));
  return `${head}.${body}.${b64u(new Uint8Array(sig))}`;
}

function userJson(u: (typeof USERS)[number]) {
  const now = new Date().toISOString();
  return {
    id: u.id,
    aud: "authenticated",
    role: "authenticated",
    email: u.email,
    email_confirmed_at: now,
    confirmed_at: now,
    phone: "",
    app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: {},
    identities: [],
    created_at: now,
    updated_at: now,
  };
}

function cors(res: Response) {
  res.headers.set("access-control-allow-origin", "*");
  res.headers.set("access-control-allow-headers", "*");
  res.headers.set("access-control-allow-methods", "*");
  return res;
}

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    if (req.method === "OPTIONS") return cors(new Response(null, { status: 204 }));

    if (url.pathname === "/auth/v1/token" && url.searchParams.get("grant_type") === "password") {
      const body = (await req.json()) as { email?: string; password?: string };
      const u = USERS.find(
        (x) => x.email.toLowerCase() === body.email?.toLowerCase() && x.password === body.password,
      );
      if (!u) {
        return cors(
          Response.json(
            { error: "invalid_grant", error_description: "Invalid login credentials" },
            { status: 400 },
          ),
        );
      }
      const now = Math.floor(Date.now() / 1000);
      const access_token = await hs256jwt({
        sub: u.id,
        email: u.email,
        role: "authenticated",
        aud: "authenticated",
        iat: now,
        exp: now + 3600,
      });
      return cors(
        Response.json({
          access_token,
          token_type: "bearer",
          expires_in: 3600,
          expires_at: now + 3600,
          refresh_token: "e2e-refresh-token",
          user: userJson(u),
        }),
      );
    }

    if (url.pathname === "/auth/v1/user") {
      const token = (req.headers.get("authorization") ?? "").replace("Bearer ", "");
      const now = Math.floor(Date.now() / 1000);
      try {
        const [h, p, s] = token.split(".");
        const key = await crypto.subtle.importKey(
          "raw",
          SECRET,
          { name: "HMAC", hash: "SHA-256" },
          false,
          ["sign"],
        );
        const expected = b64u(
          new Uint8Array(
            await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${h}.${p}`)),
          ),
        );
        const payload = JSON.parse(atob(p.replace(/-/g, "+").replace(/_/g, "/")));
        const u = USERS.find((x) => x.id === payload.sub);
        if (s !== expected || payload.exp <= now || !u) {
          return cors(Response.json({ message: "invalid claim: token invalid" }, { status: 401 }));
        }
        return cors(Response.json(userJson(u)));
      } catch {
        return cors(Response.json({ message: "invalid token" }, { status: 401 }));
      }
    }

    if (url.pathname === "/auth/v1/logout") return cors(new Response(null, { status: 204 }));
    if (
      url.pathname === "/auth/v1/token" &&
      url.searchParams.get("grant_type") === "refresh_token"
    ) {
      return cors(Response.json({ error: "unsupported_grant_type" }, { status: 400 }));
    }
    return cors(Response.json({ message: "not found" }, { status: 404 }));
  },
});
console.log(`auth stub on http://127.0.0.1:${PORT} (3 users)`);
