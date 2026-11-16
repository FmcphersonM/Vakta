import { describe, expect, it } from "vitest";
import { decrypt, encrypt, signToken, verifyToken } from "@/lib/crypto";
import { base32Decode, base32Encode, generateBackupCodes, normalizeBackupCode, totpAt, verifyTotp } from "@/lib/auth/totp";
import { hashPassword, passwordProblem, verifyPassword } from "@/lib/auth/password";

describe("encryption", () => {
  it("round-trips and uses a fresh IV each time", () => {
    const a = encrypt("hemmelig token");
    const b = encrypt("hemmelig token");
    expect(a).not.toEqual(b);
    expect(decrypt(a)).toBe("hemmelig token");
  });
  it("detects tampering", () => {
    const enc = encrypt("data");
    const parts = enc.split(".");
    parts[3] = Buffer.from("other").toString("base64url");
    expect(() => decrypt(parts.join("."))).toThrow();
  });
});

describe("signed tokens", () => {
  it("verifies and rejects tampered or expired tokens", () => {
    const t = signToken({ callId: "abc" }, 60);
    expect(verifyToken<{ callId: string }>(t)?.callId).toBe("abc");
    expect(verifyToken(t.replace(/.$/, (c) => (c === "A" ? "B" : "A")))).toBeNull();
    expect(verifyToken(signToken({ x: 1 }, -10))).toBeNull();
    expect(verifyToken("garbage")).toBeNull();
  });
});

describe("TOTP (RFC 6238 test vectors, SHA1)", () => {
  // Secret "12345678901234567890" in base32; RFC lists 8-digit codes, we check the last 6.
  const secret = base32Encode(Buffer.from("12345678901234567890"));
  it.each([
    [59, "287082"],
    [1111111109, "081804"],
    [1111111111, "050471"],
    [1234567890, "005924"],
    [2000000000, "279037"],
  ])("t=%i → %s", (t, code) => {
    expect(totpAt(secret, t)).toBe(code);
  });
  it("base32 round-trips", () => {
    const buf = Buffer.from("hello world!");
    expect(base32Decode(base32Encode(buf)).toString()).toBe("hello world!");
  });
  it("accepts ±1 step drift and rejects others", () => {
    const now = 1_700_000_000_000;
    const code = totpAt(secret, now / 1000);
    expect(verifyTotp(secret, code, now)).toBe(true);
    expect(verifyTotp(secret, code, now + 30_000)).toBe(true);
    expect(verifyTotp(secret, code, now + 95_000)).toBe(false);
    expect(verifyTotp(secret, "12345", now)).toBe(false);
  });
  it("creates 10 unique backup codes", () => {
    const { plain, hashed } = generateBackupCodes();
    expect(new Set(plain).size).toBe(10);
    expect(hashed).toHaveLength(10);
    expect(normalizeBackupCode(plain[0].toUpperCase().replace("-", " "))).toBe(plain[0]);
  });
});

describe("passwords", () => {
  it("hashes with scrypt and verifies", async () => {
    const h = await hashPassword("korrekt-hest-batteri");
    expect(h.startsWith("scrypt$")).toBe(true);
    expect(await verifyPassword("korrekt-hest-batteri", h)).toBe(true);
    expect(await verifyPassword("feil-passord", h)).toBe(false);
  });
  it("enforces minimum length", () => {
    expect(passwordProblem("kort")).toBe("too_short");
    expect(passwordProblem("lang-nok-passord")).toBeNull();
  });
});
