import type { ComponentType } from "react";

import { SignupEmail } from "./signup";
import { RecoveryEmail } from "./recovery";

import { template as memberInvitedTemplate } from "./member-invited";
import { template as orgApprovedTemplate } from "./org-approved";
import { template as orgRejectedTemplate } from "./org-rejected";

/**
 * Dynamic template-data bag passed to every template renderer and subject
 * function. All template fields are interpolated as strings.
 */
export type TemplateData = Record<string, string | undefined>;

/**
 * Erase a concrete template component's prop type so heterogeneous templates
 * can share the one `TemplateEntry` shape. Each component keeps its precise
 * props at its definition site (checked there via `satisfies TemplateEntry`).
 */
export function asTemplateComponent<P extends object>(
  component: ComponentType<P>,
): ComponentType<TemplateData> {
  return component as unknown as ComponentType<TemplateData>;
}

export interface TemplateEntry {
  component: ComponentType<TemplateData>;
  subject: string | ((data: TemplateData) => string);
  displayName?: string;
  previewData?: TemplateData;
  /** Fixed recipient — overrides caller-provided recipientEmail when set. */
  to?: string;
}

/**
 * Template registry — maps template names to their React Email components.
 * Import and register new templates here after creating them in this directory.
 */
export const TEMPLATES: Record<string, TemplateEntry> = {
  "email-confirmation": {
    component: asTemplateComponent(SignupEmail),
    subject: (d) => `Confirm your ${d?.["siteName"] ?? "ATSIQ"} email address`,
  },
  "password-recovery": {
    component: asTemplateComponent(RecoveryEmail),
    subject: (d) => `Reset your ${d?.["siteName"] ?? "ATSIQ"} password`,
  },
  "member-invited": memberInvitedTemplate,
  "org-approved": orgApprovedTemplate,
  "org-rejected": orgRejectedTemplate,
};
