/** Client-safe email-settings shape + defaults, shared by server and UI code. */
export interface EmailSettingsEffective {
  enabled: boolean;
  ackEnabled: boolean;
  stageEnabled: boolean;
  interviewEnabled: boolean;
  offerEnabled: boolean;
  replyTo: string | null;
  timezone: string;
}

export const DEFAULT_EMAIL_SETTINGS: EmailSettingsEffective = {
  enabled: true,
  ackEnabled: true,
  stageEnabled: true,
  interviewEnabled: true,
  offerEnabled: true,
  replyTo: null,
  timezone: "Asia/Kolkata",
};
