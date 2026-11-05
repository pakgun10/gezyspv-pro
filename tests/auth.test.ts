import { describe, expect, test } from "bun:test";
import { hashPassword, verifyPassword } from "../src/auth";
import { canSupervisePure } from "../src/rbac";

describe("password (argon2id)", () => {
  test("hash lalu verifikasi cocok; kata sandi salah ditolak", async () => {
    const hash = await hashPassword("rahasia123");
    expect(hash).not.toBe("rahasia123");
    expect(await verifyPassword("rahasia123", hash)).toBe(true);
    expect(await verifyPassword("salah", hash)).toBe(false);
  });

  test("hash rusak tidak membuat crash", async () => {
    expect(await verifyPassword("x", "bukan-hash")).toBe(false);
  });
});

describe("canSupervisePure — aturan penugasan", () => {
  const kepsek = { role: "supervisor" as const, is_principal: true };
  const supervisor = { role: "supervisor" as const, is_principal: false };
  const guru = { role: "guru" as const, is_principal: false };

  test("Kepala Sekolah boleh mensupervisi semua guru", () => {
    expect(canSupervisePure(kepsek, [], 99)).toBe(true);
  });

  test("supervisor biasa hanya guru yang ditugaskan", () => {
    expect(canSupervisePure(supervisor, [3, 5], 3)).toBe(true);
    expect(canSupervisePure(supervisor, [3, 5], 4)).toBe(false);
  });

  test("guru/admin tidak boleh mensupervisi", () => {
    expect(canSupervisePure(guru, [1], 1)).toBe(false);
    expect(canSupervisePure({ role: "admin" as const, is_principal: false }, [1], 1)).toBe(false);
  });
});
