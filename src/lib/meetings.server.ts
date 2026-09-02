/**
 * Meeting-link providers.
 *
 * Every credential here belongs to the HR/admin user and is stored by them on
 * the Integrations page (public.integration_credentials, service-role only).
 * Nothing is taken from the builder's own accounts.
 */

export type MeetingProviderId = "zoom" | "google_meet" | "teams";

export type MeetingRequest = {
  topic: string;
  startIso: string;
  durationMins: number;
  attendees: string[];
  agenda?: string | null;
};

export type MeetingResult = { joinUrl: string; externalId: string | null; provider: MeetingProviderId };

const FIELD_LABEL: Record<string, string> = {
  tenant_id: "Directory (tenant) ID",
  client_id: "Application (client) ID",
  client_secret: "Client secret value",
  organizer_email: "Organizer mailbox",
  account_id: "Account ID",
  refresh_token: "Refresh token",
};

function need(secrets: Record<string, string>, keys: string[], label: string) {
  const missing = keys.filter((k) => !secrets[k]);
  if (missing.length)
    throw new Error(
      `${label} is not fully configured — save ${missing
        .map((k) => FIELD_LABEL[k] ?? k)
        .join(", ")} on the Integrations page, then test again.`,
    );
}


async function jsonOrThrow(res: Response, label: string) {
  const text = await res.text();
  if (!res.ok) throw new Error(`${label} failed [${res.status}]: ${text.slice(0, 300)}`);
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(`${label} returned a non-JSON response.`);
  }
}

/* ------------------------------------------------------------------- Zoom */

async function zoomToken(s: Record<string, string>) {
  need(s, ["account_id", "client_id", "client_secret"], "Zoom");
  const basic = Buffer.from(`${s["client_id"]}:${s["client_secret"]}`).toString("base64");
  const res = await fetch(
    `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${encodeURIComponent(s["account_id"]!)}`,
    { method: "POST", headers: { Authorization: `Basic ${basic}` } },
  );
  const body = await jsonOrThrow(res, "Zoom token request");
  return String(body["access_token"] ?? "");
}

async function zoomMeeting(s: Record<string, string>, req: MeetingRequest): Promise<MeetingResult> {
  const token = await zoomToken(s);
  const res = await fetch("https://api.zoom.us/v2/users/me/meetings", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      topic: req.topic,
      type: 2,
      start_time: new Date(req.startIso).toISOString(),
      duration: req.durationMins,
      agenda: req.agenda ?? undefined,
      settings: { join_before_host: true, waiting_room: false },
    }),
  });
  const body = await jsonOrThrow(res, "Zoom meeting creation");
  return { joinUrl: String(body["join_url"] ?? ""), externalId: String(body["id"] ?? "") || null, provider: "zoom" };
}

/* ---------------------------------------------------------- Google / Meet */

async function googleToken(s: Record<string, string>) {
  need(s, ["client_id", "client_secret", "refresh_token"], "Google Calendar");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: s["client_id"]!,
      client_secret: s["client_secret"]!,
      refresh_token: s["refresh_token"]!,
    }),
  });
  const body = await jsonOrThrow(res, "Google token refresh");
  return String(body["access_token"] ?? "");
}

async function googleMeeting(s: Record<string, string>, req: MeetingRequest): Promise<MeetingResult> {
  const token = await googleToken(s);
  const start = new Date(req.startIso);
  const end = new Date(start.getTime() + req.durationMins * 60_000);
  const res = await fetch(
    "https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1&sendUpdates=all",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        summary: req.topic,
        description: req.agenda ?? undefined,
        start: { dateTime: start.toISOString() },
        end: { dateTime: end.toISOString() },
        attendees: req.attendees.filter(Boolean).map((email) => ({ email })),
        conferenceData: {
          createRequest: { requestId: crypto.randomUUID(), conferenceSolutionKey: { type: "hangoutsMeet" } },
        },
      }),
    },
  );
  const body = await jsonOrThrow(res, "Google Calendar event creation");
  const conf = body["conferenceData"] as { entryPoints?: { uri?: string }[] } | undefined;
  const joinUrl =
    (typeof body["hangoutLink"] === "string" ? body["hangoutLink"] : "") ||
    conf?.entryPoints?.find((e) => typeof e.uri === "string")?.uri ||
    "";
  return { joinUrl, externalId: (body["id"] as string | undefined) ?? null, provider: "google_meet" };
}

/* ------------------------------------------------------------------ Teams */

async function graphToken(s: Record<string, string>) {
  need(s, ["tenant_id", "client_id", "client_secret", "organizer_email"], "Microsoft Teams");
  const res = await fetch(`https://login.microsoftonline.com/${s["tenant_id"]}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: s["client_id"]!,
      client_secret: s["client_secret"]!,
      scope: "https://graph.microsoft.com/.default",
    }),
  });
  const body = await jsonOrThrow(res, "Microsoft token request");
  return String(body["access_token"] ?? "");
}

async function teamsMeeting(s: Record<string, string>, req: MeetingRequest): Promise<MeetingResult> {
  const token = await graphToken(s);
  const start = new Date(req.startIso);
  const end = new Date(start.getTime() + req.durationMins * 60_000);
  const res = await fetch(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(s["organizer_email"]!)}/onlineMeetings`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        subject: req.topic,
        startDateTime: start.toISOString(),
        endDateTime: end.toISOString(),
      }),
    },
  );
  const body = await jsonOrThrow(res, "Teams meeting creation");
  return {
    joinUrl: String(body["joinWebUrl"] ?? ""),
    externalId: (body["id"] as string | undefined) ?? null,
    provider: "teams",
  };
}

/* --------------------------------------------------------------- dispatch */

export async function createMeeting(
  provider: MeetingProviderId,
  secrets: Record<string, string>,
  req: MeetingRequest,
): Promise<MeetingResult> {
  const result =
    provider === "zoom"
      ? await zoomMeeting(secrets, req)
      : provider === "google_meet"
        ? await googleMeeting(secrets, req)
        : await teamsMeeting(secrets, req);
  if (!result.joinUrl) throw new Error(`${provider} did not return a join link.`);
  return result;
}

/** Credential check used by the Integrations "Test" button. */
export async function testMeetingProvider(provider: MeetingProviderId, secrets: Record<string, string>) {
  try {
    if (provider === "zoom") {
      await zoomToken(secrets);
      return { status: "ok" as const, message: "Zoom server-to-server credentials accepted." };
    }
    if (provider === "google_meet") {
      await googleToken(secrets);
      return { status: "ok" as const, message: "Google refresh token accepted — Meet links can be created." };
    }
    await graphToken(secrets);
    return { status: "ok" as const, message: "Microsoft Graph credentials accepted." };
  } catch (e) {
    const msg = (e as Error).message;
    return { status: msg.includes("not fully configured") ? ("pending" as const) : ("failed" as const), message: msg };
  }
}
