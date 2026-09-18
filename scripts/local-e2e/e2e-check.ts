import { chromium } from "playwright";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

async function signIn(email: string, password: string) {
  await page.goto("http://localhost:8080", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#email", { timeout: 30000 });
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.click('button[type="submit"]');
  try {
    await page.waitForSelector("text=People Excellence", { timeout: 45000 });
  } catch {
    console.log(`FAIL at ${email}: url=${page.url()}`);
    console.log("BODY:", ((await page.textContent("body")) ?? "").replace(/\s+/g, " ").slice(0, 200));
    await page.screenshot({ path: `shots/fail-${email.replace(/[^a-z0-9]/gi, "_")}.png` });
    throw new Error("workspace never rendered");
  }
  await page.waitForTimeout(2500);
}

// ---- madhu@demo.com : super admin, Demo Corp
await signIn("madhu@demo.com", "demo1234");
await page.click('a:has-text("Talent pool")');
await page.waitForSelector("text=Priya Sharma", { timeout: 30000 });
await page.waitForTimeout(1200);
const demoBody = (await page.textContent("body")) ?? "";
console.log("MADHU/DEMO  — org candidate visible:", demoBody.includes("Priya Sharma") ? "YES" : "NO",
  "| yavar candidate leaked:", demoBody.includes("Kavya Nair") ? "LEAK!" : "no");
console.log("MADHU/DEMO  — platform console nav:", demoBody.includes("Platform console") ? "YES" : "NO");
await page.screenshot({ path: "shots/demo-org-madhu.png" });

// sign out (upstream moved it into the header account menu)
await page.click("text=madhu@demo.com");
await page.click('button:has-text("Sign out")');
await page.waitForSelector("#email", { timeout: 30000 });

// ---- hr@yavar.ai : Yavar Technologies
await signIn("hr@yavar.ai", "demo1234");
await page.click('a:has-text("Talent pool")');
await page.waitForSelector("text=Kavya Nair", { timeout: 30000 });
await page.waitForTimeout(1200);
const yavarBody = (await page.textContent("body")) ?? "";
console.log("HR/YAVAR    — org candidate visible:", yavarBody.includes("Kavya Nair") ? "YES" : "NO",
  "| demo candidate leaked:", yavarBody.includes("Priya Sharma") ? "LEAK!" : "no");
console.log("HR/YAVAR    — platform console nav:", yavarBody.includes("Platform console") ? "YES (unexpected)" : "no (correct)");
await page.screenshot({ path: "shots/yavar-org-hr.png" });

await browser.close();
console.log("DONE");
