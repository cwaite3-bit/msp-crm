import { chromium } from "playwright";

const BASE = "http://localhost:3000";
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });

await page.goto(`${BASE}/login`);
await page.fill("#email", "admin@example.com");
await page.fill("#password", "ChangeMe123!");
await page.click('button[type=submit]');
await page.waitForURL(`${BASE}/`);
await page.screenshot({ path: "/tmp/shot-dashboard.png" });

await page.goto(`${BASE}/customers`);
await page.waitForSelector("text=Acme Manufacturing");
await page.screenshot({ path: "/tmp/shot-customers.png" });

await page.goto(`${BASE}/quotes`);
await page.waitForSelector("table tbody tr");
await page.locator("table tbody tr").first().locator("a").first().click();
await page.waitForURL(/\/quotes\//);
await page.waitForTimeout(500);
await page.screenshot({ path: "/tmp/shot-quote-builder.png", fullPage: true });

await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
await page.click('button:has-text("Copy client link")');
const publicUrl = await page.evaluate(() => navigator.clipboard.readText());

const publicPage = await browser.newPage({ viewport: { width: 900, height: 1100 } });
await publicPage.goto(publicUrl);
await publicPage.waitForTimeout(500);
await publicPage.screenshot({ path: "/tmp/shot-public-quote.png", fullPage: true });

await browser.close();
console.log("done:", publicUrl);
