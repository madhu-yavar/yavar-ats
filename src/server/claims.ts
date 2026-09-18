/**
 * Email-verification markers, as surfaced by the auth provider on either the
 * verified JWT claims or the GoTrue user object. Absence is NOT verification:
 * any email-keyed authorization must refuse claims that carry neither marker.
 */
export function emailVerified(claims: Record<string, unknown> | null | undefined): boolean {
  if (!claims) return false;
  return claims["email_verified"] === true || claims["email_confirmed_at"] != null;
}
