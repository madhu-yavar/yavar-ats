import type { ComponentType } from 'react'

import { template as memberInvitedTemplate } from './member-invited'
import { template as orgApprovedTemplate } from './org-approved'
import { template as orgRejectedTemplate } from './org-rejected'
import { template as authConfirmTemplate } from './signup'
import { template as authResetTemplate } from './recovery'

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
  'member-invited': memberInvitedTemplate,
  'org-approved': orgApprovedTemplate,
  'org-rejected': orgRejectedTemplate,
  'auth-confirm': authConfirmTemplate,
  'auth-reset': authResetTemplate,
}
