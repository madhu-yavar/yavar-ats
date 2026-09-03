import * as React from 'react'

import {
  Body,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from '@react-email/components'

import type { TemplateEntry } from './registry'

interface Props {
  siteName?: string
  siteUrl?: string
  orgName?: string
  ownerName?: string
  reason?: string
}

const Email = ({
  siteName = 'ATSIQ',
  siteUrl = 'https://atsiq.yavar.ai',
  orgName = 'your organisation',
  ownerName,
  reason,
}: Props) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Update on your {siteName} registration for {orgName}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Text style={brand}>{siteName}</Text>
        <Heading style={h1}>We could not approve {orgName} yet</Heading>
        <Text style={text}>{ownerName ? `Hi ${ownerName},` : 'Hello,'}</Text>
        <Text style={text}>
          Thank you for registering <strong>{orgName}</strong> on {siteName}. After review,
          our platform team was not able to approve the registration at this time.
        </Text>
        {reason ? (
          <Section style={reasonBox}>
            <Text style={reasonLabel}>Reviewer note</Text>
            <Text style={reasonText}>{reason}</Text>
          </Section>
        ) : null}
        <Hr style={hr} />
        <Section>
          <Text style={stepsTitle}>How to proceed</Text>
          <Text style={step}>
            <strong>1.</strong> Reply to this email with the clarification or corrected
            details requested above — company legal name, headquarters and a work email on
            your company domain are the usual gaps.
          </Text>
          <Text style={step}>
            <strong>2.</strong> Once we can confirm the details, we re-open the registration
            and no data needs to be entered again.
          </Text>
          <Text style={step}>
            <strong>3.</strong> If the registration was created by mistake, no action is
            needed — nothing was activated and no team members were given access.
          </Text>
        </Section>
        <Text style={footer}>
          This message relates to a registration submitted on{' '}
          <Link href={siteUrl} style={link}>
            {siteName}
          </Link>
          .
        </Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: Email,
  subject: (data: Record<string, any>) =>
    `Your ${'ATSIQ'} registration for ${data['orgName'] ?? 'your organisation'} needs attention`,
  displayName: 'Organisation registration rejected',
  previewData: {
    siteName: 'ATSIQ',
    siteUrl: 'https://atsiq.yavar.ai',
    orgName: 'Yavar TechWorks',
    ownerName: 'Madhu',
    reason: 'We could not verify the registered legal entity from the details provided.',
  },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: 'Arial, Helvetica, sans-serif' }
const container = { padding: '24px 28px', maxWidth: '560px' }
const brand = {
  fontSize: '13px',
  letterSpacing: '0.12em',
  textTransform: 'uppercase' as const,
  color: '#0f172a',
  fontWeight: 'bold' as const,
  margin: '0 0 22px',
}
const h1 = { fontSize: '22px', fontWeight: 'bold' as const, color: '#0f172a', margin: '0 0 18px' }
const text = { fontSize: '14px', color: '#45505f', lineHeight: '1.6', margin: '0 0 18px' }
const reasonBox = {
  backgroundColor: '#f6f7f9',
  borderLeft: '3px solid #0f172a',
  padding: '12px 16px',
  margin: '0 0 8px',
}
const reasonLabel = {
  fontSize: '11px',
  textTransform: 'uppercase' as const,
  letterSpacing: '0.08em',
  color: '#6b7280',
  margin: '0 0 6px',
}
const reasonText = { fontSize: '13px', color: '#0f172a', lineHeight: '1.6', margin: '0' }
const link = { color: '#1d4ed8', textDecoration: 'underline' }
const hr = { borderColor: '#e5e7eb', margin: '28px 0 20px' }
const stepsTitle = {
  fontSize: '13px',
  fontWeight: 'bold' as const,
  color: '#0f172a',
  margin: '0 0 12px',
}
const step = { fontSize: '13px', color: '#45505f', lineHeight: '1.6', margin: '0 0 10px' }
const footer = { fontSize: '12px', color: '#9ca3af', margin: '26px 0 0', lineHeight: '1.6' }
