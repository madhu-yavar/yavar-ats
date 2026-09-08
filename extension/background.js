/**
 * Guided applicant sweep.
 *
 * Runs in the recruiter's own signed-in browser, at human pace. From the
 * applicant list they already have open it first sends the job description
 * across (so the role exists in ATSIQ), then opens each applicant in turn,
 * reads the page and posts it to ATSIQ, where it is parsed, de-duplicated,
 * matched and scored. It never signs in, stores no credentials, and stops the
 * moment the recruiter presses Stop.
 */

const MAX_PROFILES = 25;
const PACE = {
  safe: [7000, 13000],
  balanced: [3000, 6000],
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jitter = ([lo, hi]) => lo + Math.floor(Math.random() * (hi - lo));

async function getRun() {
  const { run } = await chrome.storage.local.get("run");
  return run ?? null;
}

async function setRun(patch) {
  const run = (await getRun()) ?? {};
  const next = { ...run, ...patch };
  await chrome.storage.local.set({ run: next });
  return next;
}

/* --------------------------------------------------------------- page work */

function readPage() {
  const pick = (sel) => document.querySelector(sel);
  const main = pick("main") || pick("article") || pick("[role=main]") || document.body;
  const text = (main.innerText || "").replace(/\n{3,}/g, "\n\n").trim();
  return { text, title: document.title || null, url: location.href };
}

/** Collect applicant/profile links from a Recruiter list page. */
function collectApplicantLinks() {
  const out = [];
  const seen = new Set();
  for (const a of document.querySelectorAll("a[href]")) {
    const href = a.href;
    if (!/linkedin\.com\/(talent\/(profile|hire\/[^/]+\/(discover|manage)\/profile)|in\/)/i.test(href)) continue;
    const clean = href.split("#")[0];
    if (seen.has(clean)) continue;
    seen.add(clean);
    const label = (a.innerText || "").trim().split("\n")[0] || null;
    out.push({ url: clean, label });
  }
  return out;
}

async function readTab(tabId) {
  const [{ result } = {}] = await chrome.scripting.executeScript({
    target: { tabId },
    func: readPage,
  });
  return result ?? null;
}

async function waitForTab(tabId, timeoutMs = 25000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    let tab;
    try {
      tab = await chrome.tabs.get(tabId);
    } catch {
      return false;
    }
    if (tab.status === "complete") return true;
    if (Date.now() > deadline) return false;
    await sleep(500);
  }
}

/* ------------------------------------------------------------------ upload */

async function send(site, token, payload) {
  const res = await fetch(`${site}/api/public/capture`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token, ...payload }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error((body && body.detail) || `ATSIQ refused the page (${res.status}).`);
  return body;
}

/* -------------------------------------------------------------------- sweep */

async function sweep({ site, token, pace, tabId, captureJd }) {
  const links = await chrome.scripting
    .executeScript({ target: { tabId }, func: collectApplicantLinks })
    .then(([r]) => r?.result ?? [])
    .catch(() => []);

  let requisitionId = null;

  if (captureJd) {
    await setRun({ note: "Sending the job description across…" });
    try {
      const page = await readTab(tabId);
      if (page && page.text.length > 200) {
        const jd = await send(site, token, {
          kind: "jd",
          text: page.text,
          title: page.title,
          sourceUrl: page.url,
        });
        requisitionId = jd?.requisitionId ?? null;
        await setRun({ role: jd?.title ?? null });
      }
    } catch (e) {
      await setRun({ note: `Job description skipped — ${e.message}` });
    }
  }

  const queue = links.slice(0, MAX_PROFILES);
  await setRun({ total: queue.length, note: queue.length ? "Opening applicants one at a time…" : "No applicants found on this page." });

  for (let i = 0; i < queue.length; i += 1) {
    const state = await getRun();
    if (!state || state.stop) {
      await setRun({ running: false, note: "Stopped." });
      return;
    }

    const item = queue[i];
    await setRun({ index: i + 1, current: item.label ?? "Applicant" });

    let tab = null;
    try {
      tab = await chrome.tabs.create({ url: item.url, active: false });
      const ready = await waitForTab(tab.id);
      if (!ready) throw new Error("the page did not finish loading");
      await sleep(2500);
      const page = await readTab(tab.id);
      if (!page || page.text.length < 200) throw new Error("nothing readable on that profile");

      const result = await send(site, token, {
        kind: "cv",
        text: page.text,
        title: page.title,
        sourceUrl: page.url,
        ...(requisitionId ? { requisitionId } : {}),
      });
      const ok = result?.status === "imported" || result?.status === "updated";
      const s = await getRun();
      await setRun({
        imported: (s?.imported ?? 0) + (ok ? 1 : 0),
        skipped: (s?.skipped ?? 0) + (ok ? 0 : 1),
        note: result?.detail ?? "",
      });
    } catch (e) {
      const s = await getRun();
      await setRun({ failed: (s?.failed ?? 0) + 1, note: `Skipped one — ${e.message}.` });
    } finally {
      if (tab?.id) await chrome.tabs.remove(tab.id).catch(() => {});
    }

    if (i < queue.length - 1) await sleep(jitter(PACE[pace] ?? PACE.safe));
  }

  const done = await getRun();
  await setRun({
    running: false,
    note: `Finished — ${done?.imported ?? 0} filed, ${done?.skipped ?? 0} without a readable CV, ${
      done?.failed ?? 0
    } skipped.`,
  });
}

chrome.runtime.onMessage.addListener((msg, _sender, respond) => {
  if (msg?.type === "status") {
    getRun().then((run) => respond({ run }));
    return true;
  }
  if (msg?.type === "stop") {
    setRun({ stop: true }).then(() => respond({ ok: true }));
    return true;
  }
  if (msg?.type === "start") {
    (async () => {
      const existing = await getRun();
      if (existing?.running) return respond({ ok: false, error: "A sweep is already running." });
      await chrome.storage.local.set({
        run: {
          running: true,
          stop: false,
          index: 0,
          total: 0,
          imported: 0,
          skipped: 0,
          failed: 0,
          note: "Reading the applicant list…",
          startedAt: Date.now(),
        },
      });
      respond({ ok: true });
      sweep(msg.payload).catch(async (e) => {
        await setRun({ running: false, note: e.message || "The sweep stopped unexpectedly." });
      });
    })();
    return true;
  }
  return false;
});
