const $ = (id) => document.getElementById(id);
const status = (msg, cls = "") => {
  const el = $("status");
  el.textContent = msg;
  el.className = cls;
};

chrome.storage.local.get(["site", "token", "kind", "pace"], (saved) => {
  $("site").value = saved.site || "https://atsiq.yavar.ai";
  $("token").value = saved.token || "";
  $("kind").value = saved.kind || "cv";
  $("pace").value = saved.pace || "safe";
});

$("save").addEventListener("click", () => {
  chrome.storage.local.set(
    {
      site: $("site").value.trim(),
      token: $("token").value.trim(),
      kind: $("kind").value,
      pace: $("pace").value,
    },
    () => status("Settings saved.", "ok"),
  );
});

function readPage() {
  const pick = (sel) => document.querySelector(sel);
  const main = pick("main") || pick("article") || pick("[role=main]") || document.body;
  const text = (main.innerText || "").replace(/\n{3,}/g, "\n\n").trim();
  return { text, title: document.title || null, url: location.href };
}

function settings() {
  const site = $("site").value.trim().replace(/\/$/, "");
  const token = $("token").value.trim();
  return { site, token };
}

/* ------------------------------------------------------- single page capture */

$("send").addEventListener("click", async () => {
  const { site, token } = settings();
  const kind = $("kind").value;
  if (!site || !token) return status("Add your ATSIQ address and capture key first.", "err");

  chrome.storage.local.set({ site, token, kind });
  $("send").disabled = true;
  status("Reading this page…");

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const [{ result }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: readPage });
    if (!result || result.text.length < 80) throw new Error("There was not enough readable text on this page.");

    const res = await fetch(`${site}/api/public/capture`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, kind, text: result.text, title: result.title, sourceUrl: result.url }),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) throw new Error((body && body.detail) || `Capture failed (${res.status}).`);
    status(body.detail || "Sent to ATSIQ.", body.status === "error" ? "err" : "ok");
  } catch (e) {
    status(e.message || "Capture failed.", "err");
  } finally {
    $("send").disabled = false;
  }
});

/* ---------------------------------------------------------------- the sweep */

function paint(run) {
  const running = Boolean(run?.running);
  $("start").style.display = running ? "none" : "block";
  $("stop").style.display = running ? "block" : "none";
  const total = run?.total ?? 0;
  const index = run?.index ?? 0;
  $("cProg").textContent = `${index}/${total}`;
  $("cFiled").textContent = String(run?.imported ?? 0);
  $("cSkip").textContent = String((run?.skipped ?? 0) + (run?.failed ?? 0));
  $("bar").style.width = total ? `${Math.round((index / total) * 100)}%` : "0";
  $("runNote").textContent = [run?.current, run?.note].filter(Boolean).join(" — ");
}

async function refresh() {
  try {
    const res = await chrome.runtime.sendMessage({ type: "status" });
    paint(res?.run);
  } catch {
    /* worker asleep with no run in flight */
  }
}

$("start").addEventListener("click", async () => {
  const { site, token } = settings();
  const pace = $("pace").value;
  if (!site || !token) return status("Add your ATSIQ address and capture key first.", "err");
  chrome.storage.local.set({ site, token, pace });

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return status("Open your applicant list first.", "err");

  const res = await chrome.runtime.sendMessage({
    type: "start",
    payload: { site, token, pace, tabId: tab.id, captureJd: $("jd").checked },
  });
  if (!res?.ok) return status(res?.error || "The sweep could not start.", "err");
  status("Sweep running — you can close this window.", "ok");
  void refresh();
});

$("stop").addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "stop" });
  status("Stopping after the current applicant…", "");
});

void refresh();
setInterval(refresh, 1200);
