const $ = (id) => document.getElementById(id);
const status = (msg, cls = "") => {
  const el = $("status");
  el.textContent = msg;
  el.className = cls;
};

chrome.storage.local.get(["site", "token", "kind"], (saved) => {
  $("site").value = saved.site || "https://atsiq.yavar.ai";
  $("token").value = saved.token || "";
  $("kind").value = saved.kind || "cv";
});

$("save").addEventListener("click", () => {
  chrome.storage.local.set(
    { site: $("site").value.trim(), token: $("token").value.trim(), kind: $("kind").value },
    () => status("Settings saved.", "ok"),
  );
});

function readPage() {
  const pick = (sel) => document.querySelector(sel);
  const main =
    pick("main") || pick("article") || pick("[role=main]") || document.body;
  const text = (main.innerText || "").replace(/\n{3,}/g, "\n\n").trim();
  return { text, title: document.title || null, url: location.href };
}

$("send").addEventListener("click", async () => {
  const site = $("site").value.trim().replace(/\/$/, "");
  const token = $("token").value.trim();
  const kind = $("kind").value;
  if (!site || !token) return status("Add your ATSIQ address and capture key first.", "err");

  chrome.storage.local.set({ site, token, kind });
  $("send").disabled = true;
  status("Reading this page…");

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: readPage,
    });
    if (!result || result.text.length < 80) throw new Error("There was not enough readable text on this page.");

    const res = await fetch(`${site}/api/public/capture`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        token,
        kind,
        text: result.text,
        title: result.title,
        sourceUrl: result.url,
      }),
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
