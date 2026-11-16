import { expect, type Page } from "@playwright/test";

export const DEMO = { email: "demo@vakta.no", password: "Demo-passord-2026" };

export async function login(page: Page, email = DEMO.email, password = DEMO.password) {
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.getByRole("button", { name: "Logg inn" }).click();
}

export async function loginAsDemo(page: Page) {
  await login(page);
  await expect(page).toHaveURL(/\/today/);
}
