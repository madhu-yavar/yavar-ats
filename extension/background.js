/**
 * Guided applicant sweep.
 *
 * Runs in the recruiter's own signed-in browser, at human pace. From the
 * applicant list they already have open it first sends the job description
 * across (so the role exists in ATSIQ), then works through each applicant in
 * the applicant queue by profile URL, understands the active profile, and grabs
 * the attached resume file itself (the same
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

function inspectActiveProfile(expectedName) {
  const clean = (value) =>
    String(value || "")
      .replace(/\s+/g, " ")
      .trim();
  const normalise = (value) =>
    clean(value)
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9 ]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  const namesMatch = (left, right) => {
    const a = normalise(left);
    const b = normalise(right);
    if (!a || !b) return false;
    if (a.includes(b) || b.includes(a)) return true;
    const aTokens = new Set(a.split(" ").filter((token) => token.length > 1));
    const bTokens = new Set(b.split(" ").filter((token) => token.length > 1));
    const smaller = aTokens.size <= bTokens.size ? aTokens : bTokens;
    const larger = smaller === aTokens ? bTokens : aTokens;
    return smaller.size >= 2 && [...smaller].every((token) => larger.has(token));
  };
  const expected = normalise(expectedName);
  const main = document.querySelector("main, [role=main]") || document.body;
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const headings = [...main.querySelectorAll('h1, h2, h3, [role="heading"]')]
    .filter(visible)
    .map((el) => clean(el.innerText || el.textContent))
    .filter((value) => value.length >= 3 && value.length <= 140)
    .filter(
      (value) =>
        !/notifications? total|profile activity|row decorations|linkedin recruiter|highlights for this project|most recent activity/i.test(
          value,
        ),
    );
  const headingName = headings.find((value) => expected && namesMatch(value, expected)) || null;
  const publicAnchors = [
    ...main.querySelectorAll(
      'a[href*="linkedin.com/in/"], a[href*="/in/"], a[href*="public-profile"]',
    ),
  ].filter(visible);
  const profileContainers = [...main.querySelectorAll("header, section, article, div")]
    .filter(visible)
    .filter((el) => publicAnchors.some((anchor) => el.contains(anchor)))
    .filter((el) => !expected || namesMatch(el.innerText, expected))
    .sort((a, b) => clean(a.innerText).length - clean(b.innerText).length);
  const header = profileContainers[0] || publicAnchors[0]?.closest("header, section, article, div");
  const headerLines = clean(header?.innerText).split(/\n+/).map(clean).filter(Boolean);
  const headerName = headerLines.find((value) => {
    return expected && namesMatch(value.replace(/\s*[·|].*$/, ""), expected);
  });
  const candidateName = headingName || headerName?.replace(/\s*[·|].*$/, "").trim() || null;
  const publicAnchor =
    header?.querySelector('a[href*="linkedin.com/in/"], a[href*="/in/"]') ||
    publicAnchors.find((anchor) => /linkedin\.com\/in\/|\/in\//i.test(anchor.href));
  const publicProfileUrl = publicAnchor?.href ? publicAnchor.href.split(/[?#]/)[0] : null;
  const text = (main.innerText || "").replace(/\n{3,}/g, "\n\n").trim();
  const headerMatchesExpected = Boolean(
    expected && header && namesMatch(header.innerText, expected),
  );
  const candidateMatchesExpected = Boolean(
    expected && candidateName && namesMatch(candidateName, expected),
  );
  const identityConfirmed = Boolean(
    candidateName && (!expected || headerMatchesExpected || candidateMatchesExpected),
  );
  return {
    ready: Boolean(candidateName && text.length > 200),
    identityConfirmed,
    candidateName,
    publicProfileUrl,
    text,
    title: document.title || null,
    url: location.href,
  };
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
 * active profile is read, so recommendation cards can never bleed into one
 * person's record.
 */
async function grabApplicant(expectedName) {
  const normalise = (value) =>
    String(value || "")
      .toLowerCase()
      .replace(/[^a-z0-9 ]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  const usableName = (value) => {
    const clean = String(value || "")
      .replace(/\s*[|–-]\s*(LinkedIn|Recruiter).*$/i, "")
      .trim();
    if (clean.length < 3 || clean.length > 120) return null;
    if (/notifications? total|profile activity|row decorations|linkedin recruiter/i.test(clean))
      return null;
    return clean;
  };
  const candidateName = usableName(expectedName) || usableName(document.title);
  const wanted = normalise(candidateName);
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
  const publicAnchor = [
    ...scope.querySelectorAll('a[href*="linkedin.com/in/"], a[href*="/in/"]'),
    ...main.querySelectorAll('a[href*="linkedin.com/in/"], a[href*="/in/"]'),
  ].find((el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  });
  const publicProfileUrl = publicAnchor?.href ? publicAnchor.href.split(/[?#]/)[0] : null;

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
    candidateName,
    publicProfileUrl,
  };
}

/** Rank attachment controls by file-row structure, not visible button text. */
function discoverResumeActions(expectedName) {
  const normalise = (value) =>
    String(value || "")
      .toLowerCase()
      .replace(/[^a-z0-9 ]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  const namesMatch = (left, right) => {
    const a = normalise(left);
    const b = normalise(right);
    if (!a || !b) return false;
    if (a.includes(b) || b.includes(a)) return true;
    const aTokens = new Set(a.split(" ").filter((token) => token.length > 1));
    const bTokens = new Set(b.split(" ").filter((token) => token.length > 1));
    const smaller = aTokens.size <= bTokens.size ? aTokens : bTokens;
    const larger = smaller === aTokens ? bTokens : aTokens;
    return smaller.size >= 2 && [...smaller].every((token) => larger.has(token));
  };
  const wanted = normalise(expectedName);
  const main = document.querySelector("main, [role=main]") || document.body;
  if (wanted && !namesMatch(main.innerText, wanted)) {
    return {
      stage: "identity",
      error: `LinkedIn did not finish opening ${expectedName}`,
      actions: [],
    };
  }
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const valueOf = (el) =>
    [
      el.innerText,
      el.textContent,
      el.getAttribute("aria-label"),
      el.getAttribute("title"),
      el.getAttribute("data-test-icon"),
      el.getAttribute("data-view-name"),
      el.querySelector("svg")?.getAttribute("aria-label"),
      el.querySelector("svg use")?.getAttribute("href"),
    ]
      .filter(Boolean)
      .join(" ");

  const tabs = [...main.querySelectorAll('[role="tab"], button, a')].filter(visible);
  const attachmentsTab = tabs.find((el) => /attachments?/i.test(valueOf(el)));
  const panelId = attachmentsTab?.getAttribute("aria-controls");
  const panel = panelId ? document.getElementById(panelId) : null;
  const roots = [panel, main].filter(Boolean);
  const attachmentRows = [
    ...new Set(
      roots.flatMap((root) => [...root.querySelectorAll("li, tr, article, section, div")]),
    ),
  ]
    .filter((el) => {
      const r = el.getBoundingClientRect();
      const rawText = String(el.innerText || el.textContent || "");
      const text = normalise(rawText);
      return (
        visible(el) &&
        r.width >= 260 &&
        r.height >= 28 &&
        r.height <= 260 &&
        (/\.(?:pdf|docx?|rtf)\b/i.test(rawText) ||
          /\b(?:resume|curriculum vitae|cv)\b/.test(text) ||
          Boolean(
            el.querySelector('[data-test-icon*="document" i], [data-test-icon*="file" i]'),
          )) &&
        el.querySelector('button, a[href], [role="button"]')
      );
    })
    .filter((el, index, all) => !all.some((other, i) => i !== index && el.contains(other)))
    .sort((a, b) => a.innerText.length - b.innerText.length);

  const actions = [];
  attachmentRows.slice(0, 8).forEach((row, rowIndex) => {
    const filename = (row.innerText || "").match(/[^\n]+\.(?:pdf|docx?|rtf)/i)?.[0]?.trim() || null;
    const controls = [...row.querySelectorAll('a[href], button, [role="button"]')].filter(visible);
    controls.forEach((control, controlIndex) => {
      const semantic = valueOf(control).toLowerCase();
      const href = control.href || "";
      if (/preview|open viewer/.test(semantic) || control.getAttribute("aria-haspopup") === "menu")
        return;
      let score = 0;
      if (control.hasAttribute("download")) score += 100;
      if (/download|save|arrow-down|download-small/.test(semantic)) score += 90;
      if (/licdn|linkedin|ambry|dms|media-proxy|attachment/.test(href)) score += 70;
      if (controlIndex === controls.length - 1) score += 35;
      if (!(control.innerText || "").trim() && control.querySelector("svg")) score += 20;
      if (score < 20) return;
      const token = `atsiq-${Date.now()}-${rowIndex}-${controlIndex}`;
      control.setAttribute("data-atsiq-download-token", token);
      actions.push({ token, score, filename, href: href || null });
    });
  });
  actions.sort((a, b) => b.score - a.score);
  return {
    stage: actions.length ? "ready" : attachmentRows.length ? "control" : "attachment",
    error: actions.length
      ? null
      : attachmentRows.length
        ? "CV attachment was found, but its download control could not be identified"
        : "No CV file row was found in Highlights, Attachments, or recent activity",
    actions,
    canOpenAttachments: Boolean(
      attachmentsTab && attachmentsTab.getAttribute("aria-selected") !== "true",
    ),
  };
}

function openAttachmentsTab() {
  const main = document.querySelector("main, [role=main]") || document.body;
  const tab = [...main.querySelectorAll('[role="tab"], button, a')].find((el) =>
    /attachments?/i.test(
      [el.innerText, el.getAttribute("aria-label"), el.getAttribute("title")]
        .filter(Boolean)
        .join(" "),
    ),
  );
  if (!tab) return false;
  tab.scrollIntoView({ block: "center" });
  tab.click();
  return true;
}

function clickMarkedResumeAction(token) {
  const target = document.querySelector(`[data-atsiq-download-token="${CSS.escape(token)}"]`);
  if (!target) return false;
  target.scrollIntoView({ block: "center" });
  target.click();
  return true;
}

function bytesToBase64(bytes) {
  let bin = "";
  const chunk = 8192;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

/** Read an intercepted attachment URL inside LinkedIn's signed-in page. */
async function fetchResumeUrl(url, fallbackName) {
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
    : plain ||
      String(fallbackName || "")
        .split(/[\\/]/)
        .pop() ||
      "resume.pdf";
  if (!/\.(pdf|docx?|txt|rtf)$/i.test(filename)) {
    const ct = (res.headers.get("content-type") || "").toLowerCase();
    filename += ct.includes("word") || ct.includes("officedocument") ? ".docx" : ".pdf";
  }
  let bin = "";
  const chunk = 8192;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return { filename, content: btoa(bin) };
}

/**
 * Recruiter uses a real Download button rather than an <a href>. Observe the
 * browser download it creates, cancel the local copy, then read that same
 * authenticated URL into the capture payload.
 */
async function waitForDownloadEvent(timeoutMs = 6500) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      chrome.downloads.onCreated.removeListener(listener);
      resolve(null);
    }, timeoutMs);
    const listener = (item) => {
      if (item.byExtensionId && item.byExtensionId !== chrome.runtime.id) return;
      chrome.downloads.onCreated.removeListener(listener);
      clearTimeout(timer);
      resolve(item);
    };
    chrome.downloads.onCreated.addListener(listener);
  });
}

async function downloadResumeFromButton(tabId, expectedName) {
  let discovery = await run(tabId, discoverResumeActions, [expectedName]).catch(() => null);
  if (discovery?.canOpenAttachments && !discovery.actions?.length) {
    await run(tabId, openAttachmentsTab).catch(() => false);
    await sleep(900);
    discovery = await run(tabId, discoverResumeActions, [expectedName]).catch(() => null);
  }
  if (!discovery?.actions?.length) {
    throw new Error(
      `[${discovery?.stage || "attachment"}] ${discovery?.error || "CV attachment discovery failed"}`,
    );
  }

  for (const action of discovery.actions.slice(0, 4)) {
    if (action.href && /\.(pdf|docx?|rtf)(\?|$)/i.test(action.href)) {
      const direct = await run(tabId, fetchResumeUrl, [action.href, action.filename]).catch(
        () => null,
      );
      if (direct) return direct;
    }
    const waiting = waitForDownloadEvent();
    const clicked = await run(tabId, clickMarkedResumeAction, [action.token]).catch(() => false);
    if (!clicked) {
      await waiting;
      continue;
    }
    const created = await waiting;
    if (!created?.id) continue;
    await chrome.downloads.cancel(created.id).catch(() => {});
    const url = created.finalUrl || created.url;
    if (!url) continue;
    const resume = await run(tabId, fetchResumeUrl, [url, created.filename]).catch(() => null);
    await chrome.downloads.erase({ id: created.id }).catch(() => {});
    if (resume) return resume;
  }
  throw new Error(
    "[download] CV controls were tried, but LinkedIn did not deliver a readable file",
  );
}

/** Collect applicant/profile links from a Recruiter list page. */
function collectApplicantLinks() {
  const out = [];
  const seen = new Set();
  const current = new URL(location.href);
  const currentProject = current.searchParams.get("project");
  for (const a of document.querySelectorAll("a[href]")) {
    const href = a.href;
    const recruiterProfile =
      /linkedin\.com\/talent\/(profile|hire\/[^/]+\/(?:discover|manage)(?:\/[^/?#]+)*\/profile)/i.test(
        href,
      );
    const publicProfile = /linkedin\.com\/in\//i.test(href);
    if (!recruiterProfile && !publicProfile) continue;
    const row = a.closest("li, tr, article, [role=row], [data-test-applicant-row]");
    if (publicProfile) {
      const explicitApplicantRow = Boolean(
        row &&
        !row.closest("aside") &&
        (row.matches('[role="row"], [data-test-applicant-row], li, tr') ||
          /applicant|applied|qualification|good fit|not a fit|maybe/i.test(row.innerText || "")),
      );
      if (!explicitApplicantRow) continue;
    }
    const target = new URL(href, location.href);
    const targetProject = target.searchParams.get("project");
    if (currentProject && targetProject && targetProject !== currentProject) continue;
    if (recruiterProfile && currentProject && !targetProject) continue;
    if (/recommended|suggested|similar/i.test(a.closest("section, aside")?.innerText || ""))
      continue;
    const clean = href.split("#")[0];
    if (seen.has(clean)) continue;
    seen.add(clean);
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
          !/notifications? total|ago$|qualification|good fit|not a fit|maybe|pipeline|message/i.test(
            value,
          ),
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
    publicProfileUrl: page.publicProfileUrl || null,
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
      if (!ready) throw new Error("[navigation] the page did not finish loading");
      let snapshot = null;
      for (let attempt = 0; attempt < 20; attempt += 1) {
        snapshot = await run(workTabId, inspectActiveProfile, [item.label]).catch(() => null);
        if (snapshot?.ready && snapshot.identityConfirmed) break;
        await sleep(500);
      }
      if (!snapshot?.ready)
        throw new Error("[navigation] the active profile did not finish rendering");
      if (!snapshot.identityConfirmed)
        throw new Error(
          `[identity] the opened profile did not match ${item.label || "the queued applicant"}`,
        );
      const page = await run(workTabId, grabApplicant, [item.label]);
      if (!page) throw new Error("[profile] applicant details could not be read");
      const candidateName = page.candidateName || item.label;
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

if (typeof chrome !== "undefined" && chrome.runtime?.onMessage)
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
