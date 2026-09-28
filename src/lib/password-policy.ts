/**
 * Shared password policy — imported by both the auth API routes (server
 * handlers) and the client forms, so keep this module free of src/server
 * imports. The server endpoints are the source of truth; client checks only
 * exist for instant feedback.
 */

export const PASSWORD_POLICY_HINT =
  "At least 8 characters, including an uppercase letter, a lowercase letter, and a digit.";

export function passwordProblem(password: string): string | null {
  if (password.length < 8) return "Password must be at least 8 characters.";
  if (password.length > 128) return "Password must be at most 128 characters.";
  if (!/[A-Z]/.test(password)) return "Password must include an uppercase letter.";
  if (!/[a-z]/.test(password)) return "Password must include a lowercase letter.";
  if (!/[0-9]/.test(password)) return "Password must include a digit.";
  return null;
}
