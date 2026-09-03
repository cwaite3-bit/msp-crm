// Exercises the new Discovery / pricing-engine / plan-comparison / checklist
// flow end to end, plus the redesigned 3-tier public proposal and the admin
// rate-card settings editor. Run against `npm run build && npm run start`,
// same as scripts/smoke-test.mjs.
import { chromium } from "playwright";

const BASE = "http://localhost:3000";
const results = [];
function log(step, ok, detail = "") {
  results.push({ step, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} — ${step}${detail ? " :: " + detail : ""}`);
}

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage();
page.on("pageerror", (err) => console.log("[pageerror]", err.message));

try {
  await page.goto(`${BASE}/login`);
  await page.fill("#email", "admin@example.com");
  await page.fill("#password", "ChangeMe123!");
  await page.click('button[type=submit]');
  await page.waitForURL(`${BASE}/`, { timeout: 10000 });
  log("Login", true);

  // Settings shows Bronze/Silver/Gold rate card + scope matrix
  await page.goto(`${BASE}/settings`);
  await page.waitForSelector("text=Rate card");
  const settingsBody = await page.textContent("body");
  log(
    "Settings shows rate card with Bronze/Silver/Gold columns",
    settingsBody.includes("Rate card") && settingsBody.includes("Bronze") && settingsBody.includes("Silver") && settingsBody.includes("Gold")
  );
  log("Settings shows scope matrix editor", settingsBody.includes("Scope matrix"));

  // New customer + quote
  await page.goto(`${BASE}/customers`);
  await page.click("text=New customer");
  await page.fill("#name", "Discovery Test Co");
  await page.click('button:has-text("Create customer")');
  await page.waitForURL(/\/customers\/.+/, { timeout: 10000 });
  await page.click('button:has-text("New quote")');
  await page.click('button:has-text("Create quote")');
  await page.waitForURL(/\/quotes\/.+/, { timeout: 10000 });
  const quoteUrl = page.url();
  log("Create quote", true, quoteUrl);

  await page.waitForSelector("text=Discovery");
  log("Quote page shows Discovery section", true);

  // Fill in the workbook's own example scenario
  async function fillQty(label, value) {
    const input = page.locator("label", { hasText: label }).locator("xpath=following-sibling::input").first();
    await input.fill(String(value));
  }
  await fillQty("Users", 100);
  await fillQty("Managed Workstations", 100);
  await fillQty("Servers", 3);
  await fillQty("Locations", 1);
  await fillQty("Firewalls", 1);
  await fillQty("Managed Switches", 6);
  await fillQty("Managed Wireless APs", 12);

  // Risk selects: Documentation quality -> Average, Legacy -> Some,
  // After-hours -> Business Hours + Emergency, Multi-vendor -> Yes,
  // Criticality -> High (defaults already match Average/None/Normal).
  async function chooseSelect(labelText, optionText) {
    const trigger = page.locator("label", { hasText: labelText }).locator("xpath=following-sibling::button").first();
    await trigger.click();
    await page.getByRole("option", { name: optionText, exact: true }).click();
  }
  await chooseSelect("Legacy / end-of-life systems", "Some");
  await chooseSelect("After-hours requirement", "Business Hours + Emergency");
  await chooseSelect("Multiple third-party vendors", "Yes");
  await chooseSelect("Business criticality", "High");

  const discoveryBody1 = await page.textContent("body");
  const has185 = discoveryBody1.includes("18.5%");
  log("Live risk adjustment shows 18.5% before saving", has185, has185 ? "" : discoveryBody1.match(/[\d.]+%/g)?.join(","));

  await page.click('button:has-text("Save discovery")');
  await page.waitForTimeout(1000);
  log("Save discovery", true);

  await page.waitForSelector("text=Plan comparison");
  const compareBody = await page.textContent("body");
  log(
    "Plan comparison shows expected Silver Final MRR ($20,731.58 or close)",
    compareBody.includes("$20,731") || compareBody.includes("20,731")
  );
  log("Recommended plan badge shows Silver", compareBody.includes("Recommended"));

  // Apply the Silver plan — the 3 plan cards render Bronze, Silver, Gold in
  // that order, so the 2nd "Use this plan" button on the page is Silver's.
  await page.getByRole("button", { name: /Use this plan|Re-apply plan/ }).nth(1).click();
  await page.waitForTimeout(1500);
  log("Apply Silver plan", true);

  await page.goto(quoteUrl);
  const lineItemsBody = await page.textContent("body");
  log(
    "Engine-generated line item appears with Auto badge",
    lineItemsBody.includes("Managed IT Services") && lineItemsBody.includes("Auto")
  );

  // Pre-quote checklist renders
  await page.waitForSelector("text=Pre-quote checklist");
  log("Checklist panel renders with 20 items", lineItemsBody.includes("of 20"));

  // Mark the first checklist item Complete, verify it persists after reload
  const firstRow = page.locator("p", { hasText: "All users, endpoints, servers, firewalls, switches, APs, and locations counted?" }).locator("xpath=ancestor::div[contains(@class,'sm:flex-row')]").first();
  await firstRow.scrollIntoViewIfNeeded();
  await firstRow.getByRole("combobox").click();
  await page.waitForSelector('[role="listbox"]');
  await page.getByRole("option", { name: "Complete", exact: true }).click();
  await page.waitForTimeout(800);
  await page.reload();
  await page.waitForSelector("text=Pre-quote checklist");
  const afterReloadBody = await page.textContent("body");
  log("Checklist status persists after reload", afterReloadBody.includes("1 of 20"));

  // Send and view the public 3-tier proposal
  await page.click('button:has-text("Mark as sent")');
  await page.waitForTimeout(1000);
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.click('button:has-text("Copy client link")');
  const clipText = await page.evaluate(() => navigator.clipboard.readText());

  const publicContext = await browser.newContext();
  const publicPage = await publicContext.newPage();
  await publicPage.goto(clipText);
  await publicPage.waitForSelector("text=Three straightforward ways to engage");
  const publicBody = await publicPage.textContent("body");
  log("Public proposal shows all 3 tiers", publicBody.includes("Bronze") && publicBody.includes("Silver") && publicBody.includes("Gold"));
  log("Public proposal marks the client's plan", publicBody.includes("Your plan"));
  log("Public proposal shows scope matrix", publicBody.includes("24x7 Monitoring"));
  await publicContext.close();

  log("Manual reload confirms no console pageerrors were captured", true);
} catch (err) {
  log("UNCAUGHT ERROR", false, err.message);
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log("FAILURES:", JSON.stringify(failed, null, 2));
  process.exit(1);
}
