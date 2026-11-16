import { expect, test } from "@playwright/test";
import { loginAsDemo } from "./helpers";

// Needs the server started with VAKTA_FAKE_AI=1 (scripted stand-in for Claude), or a real ANTHROPIC_API_KEY.
test("browser test call: the receptionist books a befaring end to end", async ({ page }) => {
  await loginAsDemo(page);
  await page.goto("/test-agent");
  await page.getByRole("button", { name: "Les svar høyt" }).click(); // silence in CI
  await page.getByRole("button", { name: "Start samtale" }).click();
  await expect(page.getByText(/Jeg er en AI-assistent/)).toBeVisible();

  const say = async (text: string) => {
    await page.getByPlaceholder("Skriv som kunden …").fill(text);
    await page.getByRole("button", { name: "Send" }).click();
  };
  await say("Hei, det drypper fra varmtvannsberederen");
  await expect(page.getByText("Hva heter du, og hvilken adresse gjelder det?")).toBeVisible();
  await say("Ola Testmann, Kirkegata 15 Oslo");
  await expect(page.getByText(/Jeg har ledig .*Hva passer best\?/)).toBeVisible({ timeout: 20_000 });
  await say("Det første passer");
  await expect(page.getByText(/Booket .*SMS/)).toBeVisible({ timeout: 20_000 });
  await say("Nei, takk");
  await expect(page.getByRole("paragraph").filter({ hasText: "Samtalen er avsluttet." })).toBeVisible({ timeout: 20_000 });

  await page.getByRole("link", { name: "Se samtalen i loggen" }).click();
  await expect(page.getByText("Befaring booket").first()).toBeVisible();
  await expect(page.getByText("Testsamtale").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Ola Testmann" })).toBeVisible();
  await expect(page.getByText(/Booket i morgen/).first()).toBeVisible();
});
