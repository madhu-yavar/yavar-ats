// Self-hosted era: the cookie-session middleware (src/lib/auth.middleware.ts →
// requireIdentity) is the real auth gate. This module is kept as a re-export so
// every `.middleware([requireSupabaseAuth])` call site keeps working.
export { requireIdentity as requireSupabaseAuth } from "../../lib/auth.middleware";
