import { migrate } from "../scripts/migrate";

export default async function setup() {
  const url = process.env.TEST_DATABASE_URL ?? "postgres://vakta:vakta@localhost:5432/vakta_test";
  await migrate(url, { reset: true, quiet: true });
}
