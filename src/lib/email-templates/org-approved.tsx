import * as React from 'react'

import {
  Body,
  Button,
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
}

const Email = ({
  siteName = 'ATSIQ',
  siteUrl = 'https://atsiq.yavar.ai',
  orgName = 'your organisation',
  ownerName,
}: Props) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>{orgName} is approved on {siteName} — here is how to get started</Preview>
    <Body style={main}>
      <Container style={container}>
        <Text style={brand}>{siteName}</Text>
        <Heading style={h1}>{orgName} is approved</Heading>
        <Text style={text}>
          {ownerName ? `Hi ${ownerName},` : 'Hello,'}
        </Text>
        <Text style={text}>
          Our platform team has reviewed and approved <strong>{orgName}</strong>. Your
          workspace is live, and you are set up as its owner with full administrative
          rights.
        </Text>
        <Button style={button} href={siteUrl}>
          Sign in to your workspace
        </Button>
        <Hr style={hr} />
        <Section>
          <Text style={stepsTitle}>Getting started, in order</Text>
          <Text style={step}>
            <strong>1. Invite your team.</strong> Under Team, invite recruiters, hiring
            managers and your CHRO. Only addresses on your company domain can be invited,
            which keeps the roster clean.
          </Text>
          <Text style={step}>
            <strong>2. Check your master data.</strong> Departments, locations, skills and
            education levels drive every requisition and score — adjust them once, up front.
          </Text>
          <Text style={step}>
            <strong>3. Raise a requisition.</strong> Capture the role, then send it for
            approval to the department head and CHRO.
          </Text>
          <Text style={step}>
            <strong>4. Build your talent pool.</strong> Upload CVs in bulk; parsing pulls
            out skills, experience, education and social profile links automatically.
          </Text>
          <Text style={step}>
            <strong>5. Run matching.</strong> Score candidates against a requisition on
            skills, experience, career history, impact, education and social evidence, then
            move the strongest through interviews, offers and joining.
          </Text>
        </Section>
        <Text style={small}>
          Need a hand? Reply to this email, or ask the in-product assistant — it can walk
          your team through requisitions, scoring and interviews.
        </Text>
        <Text style={footer}>
          You received this message because you registered {orgName} on{' '}
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
    `${data['orgName'] ?? 'Your organisation'} is approved on ATSIQ`,
  displayName: 'Organisation approved',
  previewData: {
    siteName: 'ATSIQ',
    siteUrl: 'https://atsiq.yavar.ai',
    orgName: 'Yavar TechWorks',
    ownerName: 'Madhu',
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
const small = { fontSize: '13px', color: '#45505f', lineHeight: '1.6', margin: '22px 0 0' }
const link = { color: '#1d4ed8', textDecoration: 'underline' }
const button = {
  backgroundColor: '#0f172a',
  color: '#ffffff',
  fontSize: '14px',
  borderRadius: '8px',
  padding: '12px 22px',
  textDecoration: 'none',
  display: 'inline-block',
}
const hr = { borderColor: '#e5e7eb', margin: '28px 0 20px' }
const stepsTitle = {
  fontSize: '13px',
  fontWeight: 'bold' as const,
  color: '#0f172a',
  margin: '0 0 12px',
}
const step = { fontSize: '13px', color: '#45505f', lineHeight: '1.6', margin: '0 0 10px' }
const footer = { fontSize: '12px', color: '#9ca3af', margin: '26px 0 0', lineHeight: '1.6' }
