import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { loginAsDemo } from "./helpers";

test("create a manual lead and change its status", async ({ page }) => {
  const name = `E2E Kunde ${randomUUID().slice(0, 6)}`;
  await loginAsDemo(page);
  await page.goto("/leads/new");
  await page.fill("#name", name);
  await page.fill("#phone", "400 99 123");
  await page.fill("#address", "Storgata 1, 0155 Oslo");
  await page.fill("#description", "Lekker kran på kjøkkenet");
  await page.getByRole("button", { name: "Lagre" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(name);
  await expect(page.getByRole("link", { name: /Ring/ }).first()).toHaveAttribute("href", "tel:+4740099123");

  await page.locator("select[name=status]").first().selectOption("quoted");
  await page.waitForLoadState("networkidle");
  await page.goto("/leads?status=quoted");
  await expect(page.getByText(name)).toBeVisible();
});

function futureSlot() {
  // A random weekday slot in 2028, so repeated runs don't collide.
  const d = new Date(Date.UTC(2028, 0, 3 + Math.floor(Math.random() * 300)));
  while ([0, 6].includes(d.getUTCDay())) d.setUTCDate(d.getUTCDate() + 1);
  const hour = 8 + Math.floor(Math.random() * 6);
  return { date: d.toISOString().slice(0, 10), time: `${String(hour).padStart(2, "0")}:00` };
}

async function bookViaDialog(page: import("@playwright/test").Page, name: string, slot: { date: string; time: string }) {
  await page.getByRole("button", { name: "Ny befaring" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.locator("#customerName").fill(name);
  await dialog.locator("#customerPhone").fill("40099124");
  await dialog.locator("#date").fill(slot.date);
  await dialog.locator("input[name=time]").fill(slot.time);
  await dialog.getByRole("button", { name: "Lagre" }).click();
}

test("book a befaring from the calendar, and the same slot twice is refused", async ({ page }) => {
  const slot = futureSlot();
  await loginAsDemo(page);
  await page.goto("/calendar");
  await bookViaDialog(page, `Befaring ${randomUUID().slice(0, 6)}`, slot);
  await expect(page.locator("[role=status]").filter({ hasText: "lagt inn" })).toBeVisible();

  await bookViaDialog(page, `Dobbel ${randomUUID().slice(0, 6)}`, slot);
  await expect(page.getByRole("dialog").locator("p[role=alert]")).toContainText("kolliderer");
});

test("call detail shows summary before transcript", async ({ page }) => {
  await loginAsDemo(page);
  await page.goto("/calls?filter=booked");
  await page.locator("a[href^='/calls/']").first().click();
  const summary = page.getByText("Sammendrag");
  const transcript = page.getByRole("heading", { name: "Samtalelogg" });
  await expect(summary).toBeVisible();
  const [a, b] = await Promise.all([summary.boundingBox(), transcript.boundingBox()]);
  expect(a!.y).toBeLessThan(b!.y);
});
