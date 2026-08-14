import { chromium } from "playwright";

const BASE = "http://localhost:3000";
const results = [];

function log(step, ok, detail = "") {
  results.push({ step, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} — ${step}${detail ? " :: " + detail : ""}`);
}

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage();
page.on("console", (msg) => console.log("[console]", msg.type(), msg.text()));
page.on("pageerror", (err) => console.log("[pageerror]", err.message));

try {
  // 1. Login
  await page.goto(`${BASE}/login`);
  await page.fill("#email", "admin@example.com");
  await page.fill("#password", "ChangeMe123!");
  await page.click('button[type=submit]');
  await page.waitForURL(`${BASE}/`, { timeout: 10000 });
  log("Login", true);

  // 2. Dashboard loads
  console.log("URL after login:", page.url());
  await page.screenshot({ path: "/tmp/dashboard.png" });
  console.log("BODY:", (await page.textContent("body")).slice(0, 500));
  await page.waitForSelector("text=Dashboard");
  log("Dashboard renders", true);

  // 3. Create a customer
  await page.goto(`${BASE}/customers`);
  await page.click("text=New customer");
  await page.fill("#name", "Acme Manufacturing");
  await page.fill("#industry", "Manufacturing");
  await page.fill("#phone", "555-123-4567");
  await page.fill("#email", "info@acme.test");
  await page.fill('input[name=contactFirstName]', "Jane");
  await page.fill('input[name=contactLastName]', "Doe");
  await page.fill('input[name=contactEmail]', "jane@acme.test");
  await page.click('button:has-text("Create customer")');
  await page.waitForURL(/\/customers\/.+/, { timeout: 10000 });
  const customerUrl = page.url();
  log("Create customer", true, customerUrl);

  // 4. Verify contact tab
  await page.click("text=Contacts (1)");
  await page.waitForSelector("text=Jane Doe");
  log("Customer contact saved", true);

  // 5. Add a note
  await page.click("text=Activity (0)");
  await page.fill("textarea[name=body]", "Initial discovery call completed.");
  await page.click('button:has-text("Log activity")');
  await page.waitForSelector("text=Initial discovery call completed.");
  log("Add activity note", true);

  // 6. Create a quote
  await page.click('button:has-text("New quote")');
  await page.click('button:has-text("Create quote")');
  await page.waitForURL(/\/quotes\/.+/, { timeout: 10000 });
  const quoteUrl = page.url();
  log("Create quote", true, quoteUrl);

  // 7. Add existing catalog product
  await page.click('button:has-text("Add product / service")');
  const dialog = page.locator('[role="dialog"]');
  await dialog.getByText("Choose a product or service").click();
  await page.waitForTimeout(300);
  await page.getByText(/User support/).first().click();
  await dialog.locator('input[type=number]').first().fill("25");
  await dialog.locator('button:has-text("Add to quote")').click();
  await page.waitForTimeout(1500);
  log("Add catalog line item", true);

  // 8. Add a brand-new "on the fly" product
  await page.click('button:has-text("Add product / service")');
  const dialog2 = page.locator('[role="dialog"]');
  await dialog2.getByRole("tab", { name: "Add on the fly" }).click();
  await dialog2.getByPlaceholder(/SIEM/).fill("24/7 SOC Monitoring");
  await dialog2.getByPlaceholder("…or new category name").fill("Security");
  await dialog2.getByPlaceholder("Unit (per user…)").fill("flat");
  await dialog2.getByPlaceholder("Unit price").fill("450");
  await dialog2.getByRole("button", { name: "Add to quote" }).click();
  await page.waitForTimeout(1500);
  log("Add on-the-fly product", true);

  await page.goto(quoteUrl);
  const bodyText = await page.textContent("body");
  const hasUserSupport = bodyText.includes("User support");
  const hasSoc = bodyText.includes("24/7 SOC Monitoring");
  log("Quote shows both line items", hasUserSupport && hasSoc);

  // 9. Mark quote as sent, grab public link
  await page.click('button:has-text("Mark as sent")');
  await page.waitForTimeout(1000);
  log("Mark quote as sent", true);

  const publicPath = quoteUrl.replace(BASE, "");
  const quoteId = publicPath.split("/").pop();

  // fetch public token via page content isn't trivial; use copy button + clipboard permission
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.click('button:has-text("Copy client link")');
  const clipText = await page.evaluate(() => navigator.clipboard.readText());
  log("Copy client link", clipText.includes("/q/"), clipText);

  // 10. Visit public quote page in a fresh (unauthenticated) context
  const publicContext = await browser.newContext();
  const publicPage = await publicContext.newPage();
  await publicPage.goto(clipText);
  await publicPage.waitForSelector("text=Monthly total");
  const publicBody = await publicPage.textContent("body");
  log("Public quote page renders totals & line items", publicBody.includes("User support") && publicBody.includes("24/7 SOC Monitoring"));

  // 11. Accept the quote as the "client"
  await publicPage.click('button:has-text("Accept quote")');
  await publicPage.fill('input[placeholder="Full name"]', "Jane Doe");
  await publicPage.click('button:has-text("Confirm acceptance")');
  await publicPage.waitForSelector("text=Accepted by Jane Doe");
  log("Public accept flow", true);
  await publicContext.close();

  // 12. Back in staff view, confirm status flipped to ACCEPTED
  await page.goto(quoteUrl);
  await page.waitForSelector("text=accepted");
  log("Staff view reflects ACCEPTED status", true);

  // 13. Catalog page
  await page.goto(`${BASE}/catalog`);
  await page.waitForSelector("text=Security");
  log("Catalog shows new category/product from on-the-fly add", true);

  // 14. Settings page (QuickBooks not connected since no real credentials)
  await page.goto(`${BASE}/settings`);
  await page.waitForSelector("text=QuickBooks Online");
  await page.waitForSelector("text=Not connected.");
  log("Settings page renders QuickBooks + staff sections", true);

  // 15. Add staff user
  await page.click('button:has-text("Add staff user")');
  await page.fill('input[name=name]', "Test Tech");
  await page.fill('input[name=email]', "tech@example.com");
  await page.fill('input[name=password]', "TempPass123!");
  await page.click('button:has-text("Create user")');
  await page.waitForTimeout(1000);
  await page.waitForSelector("text=tech@example.com");
  log("Create staff user", true);
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
