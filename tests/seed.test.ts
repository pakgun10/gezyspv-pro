import { afterAll, describe, expect, test } from "bun:test";
import type { RowDataPacket } from "mysql2/promise";
import { ensureTestDb, closePool } from "./helpers";
import { countSeed, seedAll, SEED_TEMPLATE } from "../src/lib/seed";
import { hashPassword } from "../src/auth";

const pool = await ensureTestDb(process.env.TEST_DB_NAME ?? "gezyspv_test");

afterAll(async () => {
  await closePool();
});

describe("seed templat PPB/GM (Fase 0)", () => {
  test("seed mengisi semua bagian templat sesuai dokumen", async () => {
    const counts = await seedAll(pool, hashPassword, "admin123");
    expect(counts.settings).toBe(1);
    expect(counts.adminUser).toBe(1);
    expect(counts.periods).toBe(1);
    expect(counts.templates).toBe(1);
    expect(counts.principles).toBe(3);
    expect(counts.elements).toBe(4);
    expect(counts.indicators).toBe(11);
    expect(counts.scaleLevels).toBe(4);
    expect(counts.questions).toBe(10);
    expect(counts.rtlItems).toBe(3);
    expect(counts.predicates).toBe(5);
  });

  test("seed idempotent: dijalankan dua kali tidak menggandakan", async () => {
    const first = await countSeed(pool);
    await seedAll(pool, hashPassword, "admin123");
    const second = await countSeed(pool);
    expect(second).toEqual(first);
  });

  test("teks indikator dan pertanyaan verbatim dari dokumen", async () => {
    const [tpl] = await pool.query<(RowDataPacket & { id: number })[]>(
      "SELECT id FROM templates WHERE title = ? AND is_seed = 1",
      [SEED_TEMPLATE.title],
    );
    const templateId = tpl[0]!.id;
    const [indicators] = await pool.query<(RowDataPacket & { text: string })[]>(
      `SELECT ti.text FROM template_indicators ti
       JOIN template_elements te ON te.id = ti.element_id
       WHERE te.template_id = ? ORDER BY te.sort, ti.sort`,
      [templateId],
    );
    const texts = indicators.map((r) => r.text);
    expect(texts).toContain(
      'Guru secara konsisten menggunakan frasa "The Power of YET" (misal: "Kamu BELUM bisa, mari kita coba cara lain").',
    );
    expect(texts).toContain(
      "Guru memberikan pujian/apresiasi yang berfokus pada USAHA, STRATEGI, dan KETEKUNAN (bukan pujian pintar/bakat).",
    );
    const [questions] = await pool.query<(RowDataPacket & { stage: string; text: string })[]>(
      "SELECT stage, text FROM template_questions WHERE template_id = ? ORDER BY sort",
      [templateId],
    );
    expect(questions.filter((q) => q.stage === "pra")).toHaveLength(5);
    expect(questions.filter((q) => q.stage === "pasca")).toHaveLength(5);
    expect(questions[0]!.text).toBe(
      "Tujuan Pembelajaran apa yang ingin dicapai anak dalam pembelajaran hari ini?",
    );
    const [levels] = await pool.query<(RowDataPacket & { v: number; label: string })[]>(
      "SELECT v, label FROM template_scale_levels WHERE template_id = ? ORDER BY v",
      [templateId],
    );
    expect(levels.map((l) => `${l.v}=${l.label}`).join("|")).toBe(
      "1=Belum Teramati|2=Mulai Teramati (Perlu Penguatan)|3=Teramati dengan Baik|4=Sangat Teramati & Menginspirasi",
    );
  });
});
