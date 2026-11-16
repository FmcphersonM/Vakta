import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";

test("a new company signs up and has a working number in a few steps", async ({ page }) => {
  const started = Date.now();
  const tag = randomUUID().slice(0, 6);
  await page.goto("/signup");
  await page.fill("#companyName", `Nordlys Elektro ${tag}`);
  await page.selectOption("#trade", "electrician");
  await page.fill("#name", "Siri Elektriker");
  await page.fill("#email", `siri-${tag}@example.no`);
  await page.fill("#password", "sikkert-passord-2026");
  await page.check("input[name=accept]");
  await page.getByRole("button", { name: "Opprett konto" }).click();

  // 1. Business
  await expect(page).toHaveURL(/\/onboarding/);
  await expect(page.getByRole("heading", { name: "Om bedriften" })).toBeVisible();
  await page.fill("#baseAddress", "Kirkegata 15, 0153 Oslo");
  await page.getByRole("button", { name: "Neste", exact: true }).click();

  // 2. Services: pre-filled for electricians; drop one, add one
  await expect(page.getByRole("heading", { name: "Hvilke jobber tar dere?" })).toBeVisible();
  await expect(page.getByText("Elbillader")).toBeVisible();
  await page.getByLabel("Varmekabler").uncheck();
  await page.fill("#extra", "Smarthus");
  await page.getByRole("button", { name: "Neste", exact: true }).click();

  // 3. Hours: sensible defaults, just continue
  await expect(page.getByRole("heading", { name: "Når tar dere befaringer?" })).toBeVisible();
  await page.getByRole("button", { name: "Neste", exact: true }).click();

  // 4. Phone: mobile for emergencies → number assigned instantly
  await expect(page.getByRole("heading", { name: "Ditt telefonnummer" })).toBeVisible();
  await page.fill("#mobile", "912 34 567");
  await page.getByRole("button", { name: "Få telefonnummer" }).click();

  // 5. Test + finish
  await expect(page.getByRole("heading", { name: "Ta en testsamtale" })).toBeVisible();
  await expect(page.getByText(/^21 49 \d\d \d\d$/)).toBeVisible();
  await expect(page.getByText(/^\*\*004\*\+47\d{8}#$/)).toBeVisible();
  await page.getByRole("button", { name: "Gå til oversikten" }).click();
  await expect(page).toHaveURL(/\/today/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Siri");

  // Choices were saved
  await page.goto("/settings/services");
  await expect(page.locator("input[value='Smarthus']")).toBeVisible();
  await page.goto("/settings/business");
  await expect(page.locator("#baseAddress")).toHaveValue("Kirkegata 15, 0153 Oslo");
  console.log(`Automated onboarding took ${((Date.now() - started) / 1000).toFixed(1)} s`);
});
