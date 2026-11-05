import type mysql from "mysql2/promise";
import type { RowDataPacket } from "mysql2/promise";

/**
 * Seed data Fase 0 — idempotent: setiap bagian memeriksa dulu apakah
 * datanya sudah ada; dijalankan dua kali tidak menggandakan apa pun.
 * Teks templat disalin VERBATIM dari
 * INSTRUMEN_SUPERVISI_AKADEMIK_PEMBELAJARAN.docx (dibaca 2026-11-05).
 * Judul dokumen "NSTRUMEN" (huruf I hilang) adalah typo berkas sumber
 * dan TIDAK dibawa ke seed; judul templat memakai ejaan yang benar.
 */

export const SEED_TEMPLATE = {
  title: "Supervisi Akademik PPB/GM 2026/2027",
  basis: "Pola Pikir Bertumbuh / Growth Mindset (PPB/GM)",
  version_label: "2026/2027",
  score_scale: 4,
  status: "aktif" as const,
  principles: [
    "Pendekatan Kemitraan (Coaching): Supervisor bertindak sebagai mitra diskusi pertumbuhan profesional, bukan pencari kesalahan.",
    "Berfokus pada Proses & Strategi: Fokus pengamatan ada pada bagaimana guru memfasilitasi anak bereksperimen, memberikan umpan balik berbasis usaha, serta membangun budaya tidak takut salah.",
    'Penerapan The Power of YET: Mengakui bahwa kemampuan anak (dan guru) selalu berada dalam proses perkembangannya ("Belum menguasai, bukan tidak bisa").',
  ],
  elements: [
    {
      code: "A",
      title: "IKLIM BELAJAR RAMAH PERTUMBUHAN (GROWTH ENVIRONMENT)",
      indicators: [
        "Guru membangun iklim kelas yang aman untuk mencoba dan tidak takut salah (Mistakes as Learning Opportunities).",
        "Guru mengomunikasikan ekspektasi bahwa semua anak bisa berkembang melalui usaha dan latihan (No Fixed Labeling).",
        "Guru mendorong kerja sama dan saling mengapresiasi proses belajar antar teman.",
      ],
    },
    {
      code: "B",
      title: "BAHASA & UMPAN BALIK GURU (PROCESS & EFFORT FEEDBACK)",
      indicators: [
        "Guru memberikan pujian/apresiasi yang berfokus pada USAHA, STRATEGI, dan KETEKUNAN (bukan pujian pintar/bakat).",
        'Guru secara konsisten menggunakan frasa "The Power of YET" (misal: "Kamu BELUM bisa, mari kita coba cara lain").',
        "Guru mengajukan pertanyaan pemantik berpikir daripada langsung memberikan jawaban saat anak mengalami kebingungan.",
      ],
    },
    {
      code: "C",
      title: "FASILITASI TANTANGAN & RESILIENSI SISWA",
      indicators: [
        "Guru menyediakan ragam main/tantangan yang bervariasi sesuai tingkat perkembangan anak (Scaffolding).",
        "Guru mendampingi anak yang hampir menyerah dengan memberikan dorongan moral dan petunjuk kecil tanpa mengambil alih tugas.",
        "Guru memanfaatkan kegagalan eksperimen/karya sebagai bahan diskusi ilmiah bersama anak.",
      ],
    },
    {
      code: "D",
      title: "REFLEKSI PROSES & KESADARAN BELAJAR SISWA",
      indicators: [
        "Guru mengajak anak merefleksikan usaha dan kesulitan yang berhasil diatasi di akhir sesi.",
        "Guru meminta anak menceritakan strategi/cara yang mereka gunakan dalam membuat karya.",
      ],
    },
  ],
  scale_levels: [
    { v: 1, label: "Belum Teramati" },
    { v: 2, label: "Mulai Teramati (Perlu Penguatan)" },
    { v: 3, label: "Teramati dengan Baik" },
    { v: 4, label: "Sangat Teramati & Menginspirasi" },
  ],
  pra_questions: [
    "Tujuan Pembelajaran apa yang ingin dicapai anak dalam pembelajaran hari ini?",
    "Bagaimana Anda menyisipkan elemen Pola Pikir Bertumbuh (PPB/GM) dalam modul/RPP hari ini?",
    "Area spesifik mana yang ingin Anda amati bersama Supervisor? (misal: cara memberikan umpan balik proses, merespon anak yang menyerah, atau penggunaan frasa 'Belum')",
    "Tantangan apa yang Anda perkirakan akan muncul saat anak-anak melakukan kegiatan/eksperimen?",
    "Strategi apa yang disiapkan untuk membantu anak yang mengalami kesulitan tanpa langsung memberikan jawabannya?",
  ],
  pasca_questions: [
    "Bagaimana perasaan Anda setelah melaksanakan pembelajaran tadi? Hal apa yang berjalan paling baik?",
    "Momen mana yang menunjukkan anak benar-benar berusaha gigih atau belajar dari kesalahannya?",
    "Apakah ada momen di mana Anda spontan ingin memberi umpan balik hasil (misal: 'kamu pintar'), lalu mengubahnya menjadi umpan balik proses? Bagaimana reaksinya?",
    "Tantangan apa yang tadi sempat muncul dan belum berjalan sesuai harapan Anda?",
    "Strategi baru apa yang ingin Anda coba pada sesi pembelajaran berikutnya untuk semakin memperkuat Pola Pikir Bertumbuh siswa?",
  ],
  rtl_items: [
    "Apresiasi Supervisor atas Usaha & Praktik Baik Guru",
    "Area Pengembangan Fokus Pembelajaran PPB/GM Selanjutnya",
    "Dukungan/Fasilitasi yang Dibutuhkan dari Sekolah/Supervisor",
  ],
  predicates: [
    { min: 90, max: 100, label: "Sangat Baik" },
    { min: 80, max: 89, label: "Baik" },
    { min: 70, max: 79, label: "Cukup" },
    { min: 60, max: 69, label: "Kurang" },
    { min: 0, max: 59, label: "Sangat Kurang" },
  ],
};

export type SeedCounts = {
  settings: number;
  adminUser: number;
  periods: number;
  templates: number;
  principles: number;
  elements: number;
  indicators: number;
  scaleLevels: number;
  questions: number;
  rtlItems: number;
  predicates: number;
};

/** Hitung isi seed saat ini (untuk laporan & tes idempotensi). */
export async function countSeed(pool: mysql.Pool): Promise<SeedCounts> {
  const one = async (sql: string, params: unknown[] = []) => {
    const [rows] = await pool.query<(RowDataPacket & { c: number })[]>(sql, params);
    return rows[0]?.c ?? 0;
  };
  const [tpl] = await pool.query<(RowDataPacket & { id: number })[]>(
    "SELECT id FROM templates WHERE title = ? AND is_seed = 1",
    [SEED_TEMPLATE.title],
  );
  const templateId = tpl[0]?.id;
  return {
    settings: await one("SELECT COUNT(*) AS c FROM settings WHERE id = 1"),
    adminUser: await one("SELECT COUNT(*) AS c FROM users WHERE username = 'admin'"),
    periods: await one("SELECT COUNT(*) AS c FROM periods WHERE name = '2026/2027 Ganjil'"),
    templates: templateId ? 1 : 0,
    principles: templateId
      ? await one("SELECT COUNT(*) AS c FROM template_principles WHERE template_id = ?", [templateId])
      : 0,
    elements: templateId
      ? await one("SELECT COUNT(*) AS c FROM template_elements WHERE template_id = ?", [templateId])
      : 0,
    indicators: templateId
      ? await one(
          `SELECT COUNT(*) AS c FROM template_indicators
           WHERE element_id IN (SELECT id FROM template_elements WHERE template_id = ?)`,
          [templateId],
        )
      : 0,
    scaleLevels: templateId
      ? await one("SELECT COUNT(*) AS c FROM template_scale_levels WHERE template_id = ?", [templateId])
      : 0,
    questions: templateId
      ? await one("SELECT COUNT(*) AS c FROM template_questions WHERE template_id = ?", [templateId])
      : 0,
    rtlItems: templateId
      ? await one("SELECT COUNT(*) AS c FROM template_rtl_items WHERE template_id = ?", [templateId])
      : 0,
    predicates: templateId
      ? await one("SELECT COUNT(*) AS c FROM template_predicates WHERE template_id = ?", [templateId])
      : 0,
  };
}

/**
 * Jalankan seluruh seed. Aman dijalankan berulang kali.
 * `adminPassword`: kata sandi akun admin dev (dari env
 * ADMIN_DEV_PASSWORD atau default dev — lihat README).
 */
export async function seedAll(
  pool: mysql.Pool,
  hashPassword: (plain: string) => Promise<string>,
  adminPassword: string,
): Promise<SeedCounts> {
  // 1. Pengaturan sekolah (baris id = 1).
  await pool.query(
    `INSERT INTO settings (id, school_name, signature_place)
     VALUES (1, 'SMPN 1 Punggur', 'Seputih Agung')
     ON DUPLICATE KEY UPDATE school_name = school_name`,
  );

  // 2. Akun admin dev (hanya bila belum ada).
  const [admins] = await pool.query<(RowDataPacket & { id: number })[]>(
    "SELECT id FROM users WHERE username = 'admin'",
  );
  if (admins.length === 0) {
    const hash = await hashPassword(adminPassword);
    await pool.query(
      `INSERT INTO users (username, name, password_hash, role, must_change_password)
       VALUES ('admin', 'Administrator', ?, 'admin', 1)`,
      [hash],
    );
  }

  // 3. Periode aktif default.
  await pool.query(
    `INSERT INTO periods (name, is_active) VALUES ('2026/2027 Ganjil', 1)
     ON DUPLICATE KEY UPDATE name = name`,
  );
  // Pastikan tepat satu periode aktif.
  const [active] = await pool.query<(RowDataPacket & { id: number })[]>(
    "SELECT id FROM periods WHERE is_active = 1 ORDER BY id",
  );
  if (active.length > 1) {
    await pool.query(
      "UPDATE periods SET is_active = 0 WHERE id NOT IN (?)",
      [active[0]!.id],
    );
  }

  // 4. Templat seed (hanya bila belum ada).
  const [existing] = await pool.query<(RowDataPacket & { id: number })[]>(
    "SELECT id FROM templates WHERE title = ? AND is_seed = 1",
    [SEED_TEMPLATE.title],
  );
  if (existing.length === 0) {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [res] = await conn.query<mysql.ResultSetHeader>(
        `INSERT INTO templates (title, basis, version_label, score_scale, status, is_seed)
         VALUES (?, ?, ?, ?, 'aktif', 1)`,
        [
          SEED_TEMPLATE.title,
          SEED_TEMPLATE.basis,
          SEED_TEMPLATE.version_label,
          SEED_TEMPLATE.score_scale,
        ],
      );
      const templateId = res.insertId;
      for (let i = 0; i < SEED_TEMPLATE.principles.length; i++) {
        await conn.query(
          "INSERT INTO template_principles (template_id, text, sort) VALUES (?, ?, ?)",
          [templateId, SEED_TEMPLATE.principles[i], i + 1],
        );
      }
      for (let e = 0; e < SEED_TEMPLATE.elements.length; e++) {
        const el = SEED_TEMPLATE.elements[e]!;
        const [elRes] = await conn.query<mysql.ResultSetHeader>(
          "INSERT INTO template_elements (template_id, code, title, sort) VALUES (?, ?, ?, ?)",
          [templateId, el.code, el.title, e + 1],
        );
        for (let i = 0; i < el.indicators.length; i++) {
          await conn.query(
            "INSERT INTO template_indicators (element_id, text, sort) VALUES (?, ?, ?)",
            [elRes.insertId, el.indicators[i], i + 1],
          );
        }
      }
      for (const lv of SEED_TEMPLATE.scale_levels) {
        await conn.query(
          "INSERT INTO template_scale_levels (template_id, v, label) VALUES (?, ?, ?)",
          [templateId, lv.v, lv.label],
        );
      }
      const allQuestions = [
        ...SEED_TEMPLATE.pra_questions.map((t) => ({ stage: "pra", text: t })),
        ...SEED_TEMPLATE.pasca_questions.map((t) => ({ stage: "pasca", text: t })),
      ];
      for (let i = 0; i < allQuestions.length; i++) {
        await conn.query(
          "INSERT INTO template_questions (template_id, stage, text, sort) VALUES (?, ?, ?, ?)",
          [templateId, allQuestions[i]!.stage, allQuestions[i]!.text, i + 1],
        );
      }
      for (let i = 0; i < SEED_TEMPLATE.rtl_items.length; i++) {
        await conn.query(
          "INSERT INTO template_rtl_items (template_id, title, sort) VALUES (?, ?, ?)",
          [templateId, SEED_TEMPLATE.rtl_items[i], i + 1],
        );
      }
      for (let i = 0; i < SEED_TEMPLATE.predicates.length; i++) {
        const p = SEED_TEMPLATE.predicates[i]!;
        await conn.query(
          "INSERT INTO template_predicates (template_id, min_score, max_score, label, sort) VALUES (?, ?, ?, ?, ?)",
          [templateId, p.min, p.max, p.label, i + 1],
        );
      }
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }

  return countSeed(pool);
}
