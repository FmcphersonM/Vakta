import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { DEMO, login, loginAsDemo } from "./helpers";
import { totpAt } from "../src/lib/auth/totp";

test("wrong password shows a friendly error", async ({ page }) => {
  await login(page, DEMO.email, "feil-passord-123");
  await expect(page.locator("p[role=alert]")).toContainText("Feil e-post eller passord");
});

test("demo owner sees today's overview", async ({ page }) => {
  await loginAsDemo(page);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Kari");
  await expect(page.getByText("Dagens befaringer")).toBeVisible();
  await expect(page.getByRole("link", { name: /Ring tilbake/ }).first()).toBeVisible();
});

test("invite a colleague → they join → enable 2FA → log in with authenticator code", async ({ page, browser }) => {
  const email = `kollega-${randomUUID().slice(0, 8)}@example.no`;
  // Owner invites
  await loginAsDemo(page);
  await page.goto("/settings/team");
  await page.fill("#inv-email", email);
  await page.getByRole("button", { name: "Inviter kollega" }).click();
  const link = await page.locator("code").filter({ hasText: "/invite/" }).textContent();
  expect(link).toContain("/invite/");

  // Colleague accepts in a fresh browser
  const ctx = await browser.newContext({ baseURL: "http://localhost:3000" });
  const p2 = await ctx.newPage();
  await p2.goto(new URL(link!).pathname);
  await p2.fill("#name", "Test Kollega");
  await p2.fill("#password", "kollega-passord-123");
  await p2.getByRole("button", { name: "Bli med" }).click();
  await expect(p2).toHaveURL(/\/today/);

  // Enable 2FA
  await p2.goto("/settings/security");
  await p2.getByRole("button", { name: "Slå på tofaktor" }).click();
  const secret = (await p2.locator("code").first().textContent())!.replace(/\s/g, "");
  await p2.fill("#totp-code", totpAt(secret, Date.now() / 1000));
  await p2.getByRole("button", { name: "Bekreft" }).click();
  await expect(p2.getByText("Reservekoder")).toBeVisible();

  // Log out and back in: now a code is required
  await p2.goto("/settings");
  await p2.getByRole("button", { name: "Logg ut" }).click();
  await login(p2, email, "kollega-passord-123");
  await expect(p2).toHaveURL(/\/login\/verify/);
  await p2.fill("#code", "000000");
  await p2.getByRole("button", { name: "Bekreft" }).click();
  await expect(p2.locator("p[role=alert]")).toContainText("stemmer ikke");
  await p2.fill("#code", totpAt(secret, Date.now() / 1000));
  await p2.getByRole("button", { name: "Bekreft" }).click();
  await expect(p2).toHaveURL(/\/today/);
  await ctx.close();
});

test("pages are protected when logged out", async ({ page }) => {
  await page.goto("/leads");
  await expect(page).toHaveURL(/\/login/);
  const res = await page.request.get("/api/calendar/events?start=2026-01-01T00:00:00Z&end=2026-01-07T00:00:00Z");
  expect(res.status()).toBe(401);
});
