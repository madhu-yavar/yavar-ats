/**
 * Guided applicant sweep.
 *
 * Runs in the recruiter's own signed-in browser, at human pace. From the
 * applicant list they already have open it first sends the job description
 * across (so the role exists in ATSIQ), then works through each applicant,
 * grabs the attached resume file itself (the same file the Download button
 * gives) and posts it to ATSIQ, where it is parsed, de-duplicated, matched and
 * scored. It never signs in, stores no credentials, and stops the moment the
 * recruiter presses Stop.
 */

const MAX_PROFILES = 40;
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

/**
 * Read the applicant currently on screen AND pull the attached resume file the
 * page links to, using the recruiter's own session cookies.
 */
async function grabApplicant() {
  const main = document.querySelector("main") || document.body;
  const text = (main.innerText || "").replace(/\n{3,}/g, "\n\n").trim();

  const urls = [];
  const add = (u) => {
    if (u && !urls.includes(u)) urls.push(u);
  };

  // Explicit download links first, then anything embedded in a viewer.
  for (const a of document.querySelectorAll("a[href], a[download]")) {
    const href = a.href || "";
    const label = (a.innerText || a.getAttribute("aria-label") || "").toLowerCase();
    if (!href) continue;
    if (/\.(pdf|docx?|txt|rtf)(\?|$)/i.test(href)) add(href);
    else if (/download|resume|cv/.test(label) && /linkedin|licdn|ambry|dms/i.test(href)) add(href);
    else if (/ambry|dms-|media-proxy|attachment|resume/i.test(href) && /licdn|linkedin/i.test(href)) add(href);
  }
  for (const el of document.querySelectorAll("iframe[src], embed[src], object[data]")) {
    add(el.getAttribute("src") || el.getAttribute("data") || "");
  }

  let resume = null;
  for (const raw of urls.slice(0, 8)) {
    try {
      const u = new URL(raw, location.href).href;
      const res = await fetch(u, { credentials: "include" });
      if (!res.ok) continue;
      const ct = (res.headers.get("content-type") || "").toLowerCase();
      if (!/pdf|msword|officedocument|octet-stream|text\/plain/.test(ct)) continue;
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes.length < 800 || bytes.length > 6000000) continue;
      let bin = "";
      const chunk = 8192;
      for (let i = 0; i < bytes.length; i += chunk) {
        bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
      }
      const stem = decodeURIComponent(u.split("?")[0].split("/").pop() || "resume");
      const ext = /\.(pdf|docx?|txt|rtf)$/i.test(stem) ? "" : ct.includes("word") || ct.includes("officedocument") ? ".docx" : ".pdf";
      resume = { filename: `${stem}${ext}`, content: btoa(bin) };
      break;
    } catch {
      /* try the next candidate link */
    }
  }

  return { text, title: document.title || null, url: location.href, resume };
}

/** Rows in the left-hand applicant list, as the recruiter sees them. */
function listApplicantRows() {
  const rows = [];
  const mid = window.innerWidth / 2;
  for (const li of document.querySelectorAll("li, div[role='listitem'], article")) {
    const rect = li.getBoundingClientRect();
    if (rect.width < 180 || rect.width > mid + 120 || rect.height < 55) continue;
    if (rect.left > mid) continue;
    const label = (li.innerText || "").trim();
    if (label.length < 12) continue;
    if (!/\n/.test(label)) continue;
    if (li.querySelector("li")) continue;
    rows.push(label.split("\n")[0].slice(0, 120));
  }
  return rows;
}

/** Click the nth row of that same list. */
function clickApplicantRow(n) {
  const nodes = [];
  const mid = window.innerWidth / 2;
  for (const li of document.querySelectorAll("li, div[role='listitem'], article")) {
    const rect = li.getBoundingClientRect();
    if (rect.width < 180 || rect.width > mid + 120 || rect.height < 55) continue;
    if (rect.left > mid) continue;
    const label = (li.innerText || "").trim();
    if (label.length < 12 || !/\n/.test(label)) continue;
    if (li.querySelector("li")) continue;
    nodes.push(li);
  }
  const li = nodes[n];
  if (!li) return { ok: false, label: null };
  const target = li.querySelector("a[href], button, [role='button'], [tabindex]") || li;
  li.scrollIntoView({ block: "center" });
  target.click();
  return { ok: true, label: (li.innerText || "").trim().split("\n")[0] || null };
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

async function run(tabId, func, args = []) {
  const [{ result } = {}] = await chrome.scripting.executeScript({ target: { tabId }, func, args });
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

async function fileApplicant({ site, token, page, requisitionId }) {
  const payload = {
    kind: "cv",
    text: page.text && page.text.length > 80 ? page.text : null,
    title: page.title,
    sourceUrl: page.url,
    ...(page.resume ? { file: page.resume } : {}),
    ...(requisitionId ? { requisitionId } : {}),
  };
  return send(site, token, payload);
}

async function tally(result) {
  const ok = result?.status === "imported" || result?.status === "updated";
  const s = await getRun();
  await setRun({
    imported: (s?.imported ?? 0) + (ok ? 1 : 0),
    skipped: (s?.skipped ?? 0) + (ok ? 0 : 1),
    note: result?.detail ?? "",
  });
}

/* -------------------------------------------------------------------- sweep */

async function sweep({ site, token, pace, tabId, captureJd }) {
  let requisitionId = null;

  if (captureJd) {
    await setRun({ note: "Sending the job description across…" });
    try {
      const page = await run(tabId, readPage);
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

  // Preferred path: the applicant list on screen — click each row, read the
  // panel that opens and lift the attached resume file.
  const rows = (await run(tabId, listApplicantRows).catch(() => [])) ?? [];
  if (rows.length >= 2) {
    const total = Math.min(rows.length, MAX_PROFILES);
    await setRun({ total, note: "Working through the applicant list…" });

    for (let i = 0; i < total; i += 1) {
      const state = await getRun();
      if (!state || state.stop) {
        await setRun({ running: false, note: "Stopped." });
        return;
      }
      await setRun({ index: i + 1, current: rows[i] ?? "Applicant" });
      try {
        const clicked = await run(tabId, clickApplicantRow, [i]);
        if (!clicked?.ok) throw new Error("that applicant row moved");
        await sleep(2600);
        const page = await run(tabId, grabApplicant);
        if (!page || (!page.resume && page.text.length < 200)) throw new Error("no readable CV on that applicant");
        await tally(await fileApplicant({ site, token, page, requisitionId }));
      } catch (e) {
        const s = await getRun();
        await setRun({ failed: (s?.failed ?? 0) + 1, note: `Skipped one — ${e.message}.` });
      }
      if (i < total - 1) await sleep(jitter(PACE[pace] ?? PACE.safe));
    }
  } else {
    // Fallback: a page of profile links (search results, saved lists).
    const links = (await run(tabId, collectApplicantLinks).catch(() => [])) ?? [];
    const queue = links.slice(0, MAX_PROFILES);
    await setRun({
      total: queue.length,
      note: queue.length ? "Opening applicants one at a time…" : "No applicants found on this page.",
    });

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
        const page = await run(tab.id, grabApplicant);
        if (!page || (!page.resume && page.text.length < 200)) throw new Error("nothing readable on that profile");
        await tally(await fileApplicant({ site, token, page, requisitionId }));
      } catch (e) {
        const s = await getRun();
        await setRun({ failed: (s?.failed ?? 0) + 1, note: `Skipped one — ${e.message}.` });
      } finally {
        if (tab?.id) await chrome.tabs.remove(tab.id).catch(() => {});
      }

      if (i < queue.length - 1) await sleep(jitter(PACE[pace] ?? PACE.safe));
    }
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
    getRun().then((r) => respond({ run: r }));
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
