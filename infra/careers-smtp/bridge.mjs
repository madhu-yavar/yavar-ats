// Careers-inbox mail bridge: drains mailpit → ATSIQ inbound webhook.
// Same pod as mailpit (localhost API). Messages are DELETEd after a terminal
// outcome (accepted, or 4xx-rejected); only 5xx/timeouts stay for retry.
const MP = process.env.MAILPIT_URL || "http://127.0.0.1:8025";
const WEBHOOK =
  process.env.WEBHOOK_URL || "http://atsiq.atsiq.svc.cluster.local:80/api/public/inbound-email";
const SECRET = process.env.INBOUND_EMAIL_SECRET || "";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
console.log(`bridge up: MP=${MP} WEBHOOK=${WEBHOOK} secret=${SECRET ? SECRET.length + "ch" : "MISSING"}`);

async function api(path, opts) {
  const res = await fetch(`${MP}${path}`, opts);
  if (!res.ok) throw new Error(`mailpit ${path} → ${res.status}`);
  return res;
}

async function deliver(mail) {
  const detail = await (
    await api(`/api/v1/message/${mail.ID}`)
  ).json();
  const attachments = [];
  for (const a of (detail.Attachments || []).slice(0, 10)) {
    const bin = await (
      await api(`/api/v1/message/${mail.ID}/part/${encodeURIComponent(a.PartID)}`)
    ).arrayBuffer();
    attachments.push({
      filename: (a.FileName || "attachment.bin").slice(0, 300),
      contentType: a.ContentType || "application/octet-stream",
      content: Buffer.from(bin).toString("base64"),
    });
  }
  const payload = {
    to: (detail.To || []).map((a) => a.Address).join(", "),
    from: `${detail.From?.Name ? detail.From.Name + " " : ""}<${detail.From?.Address ?? ""}>`,
    subject: (detail.Subject || "").slice(0, 500),
    text: (detail.Text || "").slice(0, 400_000),
    messageId: detail.MessageID || mail.ID,
    attachments,
  };
  if (JSON.stringify(payload).length > 34_000_000) throw new Error("payload too large");
  const res = await fetch(WEBHOOK, {
    method: "POST",
    headers: { "content-type": "application/json", "x-inbound-secret": SECRET },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  if (res.status >= 500) throw new Error(`webhook ${res.status}: ${text.slice(0, 200)}`);
  if (res.status >= 400) console.error(`webhook ${res.status}: ${text.slice(0, 300)}`);
  else console.log(`delivered ${mail.ID} → ${res.status} ${text.slice(0, 140)}`);
}

for (;;) {
  try {
    const summary = await (
      await api("/api/v1/messages?limit=25")
    ).json();
    for (const m of summary.messages ?? []) {
      try {
        await deliver(m);
      } catch (e) {
        console.error("deliver failed:", e.message, "| cause:", e.cause?.message ?? e.cause?.code ?? "-");
      }
      await fetch(`${MP}/api/v1/messages/${m.ID}`, { method: "DELETE" }).catch(() => {});
    }
  } catch (e) {
    console.error("poll failed:", e.message, "| cause:", e.cause?.message ?? e.cause?.code ?? "-");
  }
  await sleep(15_000);
}
