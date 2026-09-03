/**
 * Work-email originality checks. There is no way to prove a company exists from an
 * email address alone, so we enforce the checks that actually stop casual abuse:
 *
 * 1. the address must be deliverable-looking and not a free consumer mailbox,
 * 2. it must not be a known disposable/throwaway domain,
 * 3. every internal user of a tenant must share the owner's verified domain,
 * 4. Supabase Auth confirms the mailbox itself (confirmation link) before sign-in.
 */

const FREE_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "yahoo.co.in",
  "yahoo.co.uk",
  "ymail.com",
  "rocketmail.com",
  "hotmail.com",
  "hotmail.co.uk",
  "outlook.com",
  "live.com",
  "msn.com",
  "aol.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "gmx.com",
  "gmx.de",
  "mail.com",
  "mail.ru",
  "yandex.com",
  "yandex.ru",
  "zoho.com",
  "protonmail.com",
  "proton.me",
  "pm.me",
  "rediffmail.com",
  "qq.com",
  "163.com",
  "126.com",
  "naver.com",
  "hushmail.com",
  "inbox.com",
  "fastmail.com",
]);

const DISPOSABLE_DOMAINS = new Set([
  "mailinator.com",
  "guerrillamail.com",
  "10minutemail.com",
  "tempmail.com",
  "temp-mail.org",
  "trashmail.com",
  "yopmail.com",
  "dispostable.com",
  "getnada.com",
  "sharklasers.com",
  "throwawaymail.com",
  "maildrop.cc",
  "fakeinbox.com",
  "mytemp.email",
  "moakt.com",
  "emailondeck.com",
  "tempr.email",
  "spam4.me",
  "mailnesia.com",
  "discard.email",
]);

export function emailDomain(email: string) {
  return email.trim().toLowerCase().split("@")[1] ?? "";
}

export function isFreeEmailDomain(email: string) {
  return FREE_DOMAINS.has(emailDomain(email));
}

export function isDisposableEmailDomain(email: string) {
  const d = emailDomain(email);
  return DISPOSABLE_DOMAINS.has(d) || /(^|\.)(mailinator|yopmail|tempmail|trashmail)\./.test(d);
}

/** Returns a human message when the address is not usable as a corporate identity. */
export function workEmailProblem(email: string): string | null {
  const value = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(value)) return "Enter a valid email address.";
  const domain = emailDomain(value);
  if (!domain || domain.length < 4) return "Enter a valid email domain.";
  if (isDisposableEmailDomain(value)) return "Disposable email domains are not accepted.";
  if (isFreeEmailDomain(value))
    return `Use your company email address — ${domain} is a personal mailbox provider.`;
  return null;
}

/** Internal users must live on the same verified domain as the organisation owner. */
export function sameDomain(a: string, b: string) {
  return emailDomain(a) === emailDomain(b);
}
