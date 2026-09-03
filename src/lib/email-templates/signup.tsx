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

interface SignupEmailProps {
  siteName: string
  siteUrl: string
  recipient: string
  confirmationUrl: string
}

export const SignupEmail = ({
  siteName,
  siteUrl,
  recipient,
  confirmationUrl,
}: SignupEmailProps) => (
  <Html lang="en" dir="ltr">
    <Head>
      <style>{darkModeCss}</style>
    </Head>
    <Preview>Confirm {recipient} to finish setting up your {siteName} account</Preview>
    <Body style={main}>
      <Container style={container}>
        <Text style={brand}>{siteName}</Text>
        <Heading style={h1}>Confirm your work email address</Heading>
        <Text style={text}>
          You (or a colleague) started registering an organisation on{' '}
          <Link href={siteUrl} style={link}>
            {siteName}
          </Link>
          , the applicant tracking and candidate scoring platform, using{' '}
          <strong>{recipient}</strong>.
        </Text>
        <Text style={text}>
          Confirming this address proves the mailbox belongs to you. It is required before
          your organisation can be submitted to our team for approval.
        </Text>
        <Button className="dm-btn" style={button} href={confirmationUrl}>
          Confirm email address
        </Button>
        <Text style={small}>
          The link is valid for a limited time and can be used once. If the button does not
          work, copy this address into your browser:
          <br />
          <Link href={confirmationUrl} style={link}>
            {confirmationUrl}
          </Link>
        </Text>
        <Hr style={hr} />
        <Section>
          <Text style={stepsTitle}>What happens next</Text>
          <Text style={step}>1. Confirm this email address.</Text>
          <Text style={step}>
            2. Complete your organisation profile — legal name, industry, headquarters,
            currency, departments and hiring locations.
          </Text>
          <Text style={step}>
            3. Our platform team reviews the registration. You will receive a decision by
            email, with sign-in instructions once approved.
          </Text>
          <Text style={step}>
            4. After approval you can invite your recruiters and hiring managers on your own
            company domain and start raising requisitions.
          </Text>
        </Section>
        <Text style={footer}>
          If you did not start this registration, you can safely ignore this message — no
          account is created without confirmation, and nobody gains access to your
          organisation's data.
        </Text>
      </Container>
    </Body>
  </Html>
)

export default SignupEmail

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
const h1 = {
  fontSize: '22px',
  fontWeight: 'bold' as const,
  color: '#0f172a',
  margin: '0 0 18px',
}
const text = {
  fontSize: '14px',
  color: '#45505f',
  lineHeight: '1.6',
  margin: '0 0 18px',
}
const small = { fontSize: '12px', color: '#6b7280', lineHeight: '1.6', margin: '20px 0 0' }
const link = { color: '#1d4ed8', textDecoration: 'underline' }
const button = {
  backgroundColor: '#0f172a',
  color: '#ffffff',
  fontSize: '14px',
  border: '1px solid #0f172a',
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
  margin: '0 0 10px',
}
const step = { fontSize: '13px', color: '#45505f', lineHeight: '1.6', margin: '0 0 8px' }
const footer = { fontSize: '12px', color: '#9ca3af', margin: '26px 0 0', lineHeight: '1.6' }
// Rendered as a text child, which React may HTML-escape: keep this CSS free of >, &, and quotes.
const darkModeCss = `
  @media (prefers-color-scheme: dark) {
    .dm-btn { background-color: #ffffff !important; color: #0f172a !important; }
  }
  [data-ogsc] .dm-btn { background-color: #ffffff !important; color: #0f172a !important; }
  [data-ogsb] .dm-btn { background-color: #ffffff !important; color: #0f172a !important; }
`
