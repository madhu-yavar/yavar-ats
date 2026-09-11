/**
 * Guided applicant sweep.
 *
 * Runs in the recruiter's own signed-in browser, at human pace. From the
 * applicant list they already have open it first sends the job description
 * across (so the role exists in ATSIQ), then works through each applicant in
 * the left-hand list by name, grabs the attached resume file itself (the same
 * file the Download button gives) and posts it to ATSIQ, where it is parsed,
 * de-duplicated, matched and scored. It never signs in, stores no credentials,
 * and stops the moment the recruiter presses Stop.
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
 * One injected worker for everything to do with the applicant list, so the
 * same idea of "a row" is used to count, to scroll and to click.
 *
 * action: "names" | "click" | "scroll"
 */
function rowScan(action, arg) {
  const mid = window.innerWidth / 2;

  const qualifies = (el) => {
    const r = el.getBoundingClientRect();
    if (r.height < 55 || r.height > 460) return false;
    if (r.width < 180 || r.width > mid + 240) return false;
    if (r.left > mid + 60) return false;
    const t = (el.innerText || "").trim();
    if (t.length < 15 || t.length > 1400) return false;
    if (!t.includes("\n")) return false;
    const hasProfile = Boolean(el.querySelector('a[href*="/talent/profile"], a[href*="/in/"]'));
    const looksApplicant =
      hasProfile ||
      Boolean(el.querySelector("img")) ||
      /applied|·\s*\d(?:st|nd|rd)|qualification|maybe|good fit|not a fit/i.test(t);
    return looksApplicant;
  };

  const found = [];
  for (const el of document.querySelectorAll("li, div, article, tr")) {
    if (qualifies(el)) found.push(el);
  }
  // keep only the innermost matches, so a wrapper around the whole list is dropped
  const rows = found.filter((el) => !found.some((other) => other !== el && el.contains(other)));

  const nameOf = (el) => {
    const lines = (el.innerText || "")
      .trim()
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    return (lines[0] || "").replace(/\s*·.*$/, "").slice(0, 120);
  };

  if (action === "names") {
    const seen = new Set();
    const out = [];
    for (const el of rows) {
      const n = nameOf(el);
      if (n.length < 3 || seen.has(n)) continue;
      seen.add(n);
      out.push(n);
    }
    return out;
  }

  if (action === "click") {
    const want = String(arg || "").toLowerCase();
    const head = want.slice(0, 18);
    const el =
      rows.find((r) => nameOf(r).toLowerCase() === want) ||
      rows.find((r) => nameOf(r).toLowerCase().startsWith(head));
    if (!el) return { ok: false };
    el.scrollIntoView({ block: "center" });
    const target =
      el.querySelector('a[href*="/talent/"], a[href*="/in/"], a[href], button, [role="button"]') ||
      el;
    target.click();
    return { ok: true, name: nameOf(el) };
  }

  if (action === "scroll") {
    let node = rows[0] || null;
    while (node && !(node.scrollHeight > node.clientHeight + 40)) node = node.parentElement;
    const target = node || document.scrollingElement || document.body;
    const before = target.scrollTop;
    target.scrollTop = before + Math.max(300, target.clientHeight * 0.85);
    return { moved: target.scrollTop > before };
  }

  return null;
}

/**
 * Read the applicant currently on screen AND pull the attached resume file the
 * page links to, using the recruiter's own session cookies. Only the detail
 * panel on the right is read, so the other applicants in the list can never
 * bleed into one person's record.
 */
async function grabApplicant(expectedName) {
  const normalise = (value) =>
    String(value || "")
      .toLowerCase()
      .replace(/[^a-z0-9 ]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  const wanted = normalise(expectedName);
  const main =
    document.querySelector("main") || document.querySelector("[role=main]") || document.body;
  const candidates = [...main.querySelectorAll("section, article, div")]
    .filter((el) => {
      const r = el.getBoundingClientRect();
      const value = normalise(el.innerText);
      return (
        r.width >= 420 &&
        r.height >= 300 &&
        (!wanted || value.includes(wanted)) &&
        /summary|experience|highlights for this project|attachments?/.test(value)
      );
    })
    .sort((a, b) => a.innerText.length - b.innerText.length);
  const scope = candidates[0] || main;
  const text = (scope.innerText || "").replace(/\n{3,}/g, "\n\n").trim();

  const urls = [];
  const add = (u) => {
    if (u && !urls.includes(u)) urls.push(u);
  };

  const linkScope = scope.querySelector("a[href], iframe[src]") ? scope : document;
  for (const a of linkScope.querySelectorAll("a[href], a[download]")) {
    const href = a.href || "";
    const label = (a.innerText || a.getAttribute("aria-label") || "").toLowerCase();
    if (!href) continue;
    if (/\.(pdf|docx?|txt|rtf)(\?|$)/i.test(href)) add(href);
    else if (/download|resume|cv/.test(label) && /linkedin|licdn|ambry|dms/i.test(href)) add(href);
    else if (/ambry|dms-|media-proxy|attachment|resume/i.test(href) && /licdn|linkedin/i.test(href))
      add(href);
  }
  for (const el of linkScope.querySelectorAll("iframe[src], embed[src], object[data]")) {
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
      const ext = /\.(pdf|docx?|txt|rtf)$/i.test(stem)
        ? ""
        : ct.includes("word") || ct.includes("officedocument")
          ? ".docx"
          : ".pdf";
      resume = { filename: `${stem}${ext}`, content: btoa(bin) };
      break;
    } catch {
      /* try the next candidate link */
    }
  }

  return {
    text,
    title: document.title || null,
    url: location.href,
    resume,
    candidateName: expectedName || null,
  };
}

/** Click LinkedIn's visible CV download control when no direct file URL exists. */
function clickResumeDownload(expectedName) {
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < window.innerHeight;
  };
  const normalise = (value) =>
    String(value || "")
      .toLowerCase()
      .replace(/[^a-z0-9 ]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  const wanted = normalise(expectedName);
  const attachmentRows = [
    ...document.querySelectorAll("main li, main tr, main article, main section, main div"),
  ]
    .filter((el) => {
      const r = el.getBoundingClientRect();
      const text = normalise(el.innerText);
      return (
        r.width >= 260 &&
        r.height >= 28 &&
        r.height <= 220 &&
        /\.pdf\b|\.docx?\b|\(resume\)|\bcv\b/.test(text) &&
        el.querySelector('button, a[href], [role="button"]')
      );
    })
    .sort((a, b) => a.innerText.length - b.innerText.length)[0];
  const profile =
    document.querySelector("main") || document.querySelector("[role=main]") || document.body;
  if (wanted && !normalise(profile.innerText).includes(wanted)) {
    return { ok: false, error: `LinkedIn did not finish opening ${expectedName}` };
  }
  if (!attachmentRows) return { ok: false, error: "CV attachment row was not found" };
  const controls = [...attachmentRows.querySelectorAll('button, a[href], [role="button"]')].filter(
    visible,
  );
  const labelled = controls.find((el) => {
    const text = [el.innerText, el.getAttribute("aria-label"), el.getAttribute("title")]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return /download|save/.test(text);
  });
  const iconOnly = [...controls]
    .reverse()
    .find(
      (el) =>
        !/preview/i.test(
          [el.innerText, el.getAttribute("aria-label"), el.getAttribute("title")]
            .filter(Boolean)
            .join(" "),
        ),
    );
  const target = labelled || iconOnly;
  if (!target) return { ok: false, error: "CV Download button was not found" };
  target.click();
  return { ok: true };
}

function bytesToBase64(bytes) {
  let bin = "";
  const chunk = 8192;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

/**
 * Recruiter uses a real Download button rather than an <a href>. Observe the
 * browser download it creates, cancel the local copy, then read that same
 * authenticated URL into the capture payload.
 */
async function downloadResumeFromButton(tabId, expectedName) {
  let created = null;
  const waitForDownload = new Promise((resolve) => {
    const timer = setTimeout(() => {
      chrome.downloads.onCreated.removeListener(listener);
      resolve(null);
    }, 12000);
    const listener = (item) => {
      if (item.byExtensionId && item.byExtensionId !== chrome.runtime.id) return;
      chrome.downloads.onCreated.removeListener(listener);
      clearTimeout(timer);
      resolve(item);
    };
    chrome.downloads.onCreated.addListener(listener);
  });

  const clicked = await run(tabId, clickResumeDownload, [expectedName]).catch(() => null);
  if (!clicked?.ok) throw new Error(clicked?.error || "CV Download button was not found");
  created = await waitForDownload;
  if (!created?.id) return null;

  await chrome.downloads.cancel(created.id).catch(() => {});
  const url = created.finalUrl || created.url;
  if (!url) return null;
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) throw new Error(`CV download returned ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.length < 800 || bytes.length > 6000000)
    throw new Error("downloaded CV has an invalid size");
  const disposition = res.headers.get("content-disposition") || "";
  const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  const plain = disposition.match(/filename="?([^";]+)"?/i)?.[1];
  let filename = encoded
    ? decodeURIComponent(encoded)
    : plain || created.filename?.split(/[\\/]/).pop() || "resume.pdf";
  if (!/\.(pdf|docx?|txt|rtf)$/i.test(filename)) {
    const ct = (res.headers.get("content-type") || created.mime || "").toLowerCase();
    filename += ct.includes("word") || ct.includes("officedocument") ? ".docx" : ".pdf";
  }
  await chrome.downloads.erase({ id: created.id }).catch(() => {});
  return { filename, content: bytesToBase64(bytes) };
}

/** Collect applicant/profile links from a Recruiter list page. */
function collectApplicantLinks() {
  const out = [];
  const seen = new Set();
  for (const a of document.querySelectorAll("a[href]")) {
    const href = a.href;
    if (
      !/linkedin\.com\/(talent\/(profile|hire\/[^/]+\/(?:discover|manage)(?:\/[^/?#]+)*\/profile)|in\/)/i.test(
        href,
      )
    )
      continue;
    const clean = href.split("#")[0];
    if (seen.has(clean)) continue;
    seen.add(clean);
    const row = a.closest("li, tr, article, [role=row], [data-test-applicant-row]");
    const candidates = [a.innerText || "", row?.innerText || ""]
      .flatMap((value) => value.split("\n"))
      .map((value) =>
        value
          .trim()
          .replace(/^view\s+/i, "")
          .replace(/\s+profile$/i, ""),
      )
      .filter(
        (value) =>
          value.length >= 3 &&
          value.length <= 120 &&
          !/^(profile|applicant|applied|view profile|profile activity row decorations)$/i.test(
            value,
          ) &&
          !/ago$|qualification|good fit|not a fit|maybe|pipeline|message/i.test(value),
      );
    const label = candidates[0] || null;
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

async function fileApplicant({ site, token, page, requisitionId, candidateName }) {
  const payload = {
    kind: "cv",
    text: page.text && page.text.length > 80 ? page.text : null,
    title: page.title,
    sourceUrl: page.url,
    candidateName: candidateName || null,
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

/** Walk LinkedIn's virtual list and retain each applicant's exact profile URL. */
async function gatherApplicantLinks(tabId) {
  const links = [];
  const seen = new Set();
  for (let pass = 0; pass < 16 && links.length < MAX_PROFILES; pass += 1) {
    const batch = (await run(tabId, collectApplicantLinks).catch(() => [])) ?? [];
    let added = 0;
    for (const item of batch) {
      if (!item?.url || seen.has(item.url)) continue;
      seen.add(item.url);
      links.push(item);
      added += 1;
    }
    await setRun({ note: `Reading the applicant list — ${links.length} found so far…` });
    const scrolled = await run(tabId, rowScan, ["scroll"]).catch(() => null);
    if (!scrolled?.moved && added === 0) break;
    await sleep(900);
  }
  return links.slice(0, MAX_PROFILES);
}

/* -------------------------------------------------------------------- sweep */

async function sweep({ site, token, pace, tabId, captureJd }) {
  let requisitionId = null;
  // Use the Recruiter tab the HR user opened. LinkedIn changes its address to
  // the selected applicant, which makes the sweep visible and gives ATSIQ the
  // exact Recruiter profile link for every candidate.
  const workTabId = tabId;
  await chrome.tabs.update(workTabId, { active: true }).catch(() => {});

  if (captureJd) {
    await setRun({ note: "Sending the job description across…" });
    try {
      const page = await run(workTabId, readPage);
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

  // Keep exact profile URLs before leaving the virtualised applicant list. A
  // hard navigation per person prevents LinkedIn's previous detail panel (and
  // its CV button) from being reused for the next applicant.
  const queue = await gatherApplicantLinks(workTabId);
  await setRun({
    total: queue.length,
    note: queue.length
      ? `${queue.length} applicants found — opening each profile directly…`
      : "No applicant profile links were found — open the applicant list for one job and try again.",
  });

  for (let i = 0; i < queue.length; i += 1) {
    const state = await getRun();
    if (!state || state.stop) {
      await setRun({ running: false, note: "Stopped." });
      return;
    }
    const item = queue[i];
    await setRun({ index: i + 1, current: item.label ?? "Applicant" });

    try {
      await chrome.tabs.update(workTabId, { url: item.url, active: true });
      const ready = await waitForTab(workTabId);
      if (!ready) throw new Error("the page did not finish loading");
      await sleep(4000);
      const page = await run(workTabId, grabApplicant, [item.label]);
      if (!page) throw new Error("applicant details did not open");
      const candidateName = item.label || page.candidateName;
      if (!candidateName) throw new Error("the applicant name could not be confirmed");
      if (!page.resume) page.resume = await downloadResumeFromButton(workTabId, candidateName);
      if (!page.resume)
        throw new Error("the original CV could not be downloaded — nothing was filed");
      await tally(await fileApplicant({ site, token, page, requisitionId, candidateName }));
    } catch (e) {
      const s = await getRun();
      await setRun({
        failed: (s?.failed ?? 0) + 1,
        note: `Skipped ${item.label || "one applicant"} — ${e.message}.`,
      });
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
