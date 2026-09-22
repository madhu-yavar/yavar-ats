import type { ComponentType } from 'react'

import { SignupEmail } from './signup'
import { RecoveryEmail } from './recovery'

import { template as memberInvitedTemplate } from './member-invited'
import { template as orgApprovedTemplate } from './org-approved'
import { template as orgRejectedTemplate } from './org-rejected'

export interface TemplateEntry {
  component: ComponentType<any>
  subject: string | ((data: Record<string, any>) => string)
  displayName?: string
  previewData?: Record<string, any>
  /** Fixed recipient — overrides caller-provided recipientEmail when set. */
  to?: string
}

/**
 * Template registry — maps template names to their React Email components.
 * Import and register new templates here after creating them in this directory.
 */
export const TEMPLATES: Record<string, TemplateEntry> = {
  'email-confirmation': {
    component: SignupEmail as ComponentType<any>,
    subject: (d) => `Confirm your ${d?.["siteName"] ?? "ATSIQ"} email address`,
  },
  'password-recovery': {
    component: RecoveryEmail as ComponentType<any>,
    subject: (d) => `Reset your ${d?.["siteName"] ?? "ATSIQ"} password`,
  },
  'member-invited': memberInvitedTemplate,
  'org-approved': orgApprovedTemplate,
  'org-rejected': orgRejectedTemplate,
}
