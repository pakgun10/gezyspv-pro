import { Elysia } from "elysia";
import type { RowDataPacket } from "mysql2/promise";
import { getPool } from "../db";
import { authPlugin, requireAuth } from "./auth";
import { alertBox, card, layout, statCard } from "../views";
import { supervisedTeacherIds } from "../rbac";

export const dashboardRoutes = new Elysia().use(authPlugin).onBeforeHandle(requireAuth).get(
  "/",
  async ({ user }: any) => {
    const pool = getPool();
    const [srows] = await pool.query<(RowDataPacket & { school_name: string })[]>(
      "SELECT school_name FROM settings WHERE id = 1",
    );
    const schoolName = srows[0]?.school_name ?? "SMPN 1 Punggur";
    const one = async (sql: string, params: unknown[] = []) => {
      const [rows] = await pool.query<(RowDataPacket & { c: number })[]>(sql, params);
      return rows[0]?.c ?? 0;
    };

    let body = "";
    if (user!.role === "admin") {
      const [guru, kelas, supervisor, templat, periode] = await Promise.all([
        one("SELECT COUNT(*) AS c FROM users WHERE role = 'guru'"),
        one("SELECT COUNT(*) AS c FROM classes"),
        one("SELECT COUNT(*) AS c FROM users WHERE role = 'supervisor'"),
        one("SELECT COUNT(*) AS c FROM templates"),
        one("SELECT COUNT(*) AS c FROM periods WHERE is_active = 1"),
      ]);
      body = `
<h1 class="text-2xl font-bold text-slate-900 mb-1">Dasbor Admin</h1>
<p class="text-slate-500 mb-6">Selamat datang, ${user!.name}. Kelola data dasar supervisi dari sini.</p>
<div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
  ${statCard("Guru", guru, "akun guru terdaftar")}
  ${statCard("Kelas", kelas, "kelas pada semua periode")}
  ${statCard("Supervisor", supervisor, "akun supervisor")}
  ${statCard("Templat", templat, "instrumen supervisi")}
</div>
<div class="grid md:grid-cols-2 gap-4">
  ${card(
    "Langkah awal Fase 0",
    `<ol class="list-decimal pl-5 space-y-1.5 text-sm text-slate-700">
      <li>Periksa <a class="text-teal-700 font-semibold underline" href="/admin/pengaturan">pengaturan sekolah</a> (nama sekolah, kepala sekolah, tempat tanda tangan).</li>
      <li>Tambah guru lewat <a class="text-teal-700 font-semibold underline" href="/admin/guru">menu Guru</a> (manual atau impor CSV).</li>
      <li>Tambah kelas lewat <a class="text-teal-700 font-semibold underline" href="/admin/kelas">menu Kelas</a> dan aktifkan periode di <a class="text-teal-700 font-semibold underline" href="/admin/periode">menu Periode</a>.</li>
      <li>Buat akun supervisor lalu tetapkan penugasannya di <a class="text-teal-700 font-semibold underline" href="/admin/penugasan">menu Penugasan</a>.</li>
    </ol>
    <p class="text-sm text-slate-500 mt-3">Periode aktif: <strong>${periode} periode</strong> (seharusnya tepat 1).</p>`,
  )}
  ${card(
    "Supervisi (Fase 2)",
    `<p class="text-sm text-slate-700">Pembuatan sesi supervisi, pengisian skor, dan rekap dibangun pada Fase 2–3. Templat instrumen bawaan sudah tersedia di database (seed) dan akan bisa dikelola pada Fase 1.</p>
    ${alertBox("info", "Fase 0 = fondasi: data dasar, auth, dan penugasan supervisor.")}`,
  )}
</div>`;
    } else if (user!.role === "supervisor") {
      const ids = await supervisedTeacherIds(pool, user!);
      const [templates] = await pool.query<(RowDataPacket & { c: number })[]>(
        "SELECT COUNT(*) AS c FROM templates WHERE status = 'aktif'",
      );
      body = `
<h1 class="text-2xl font-bold text-slate-900 mb-1">Dasbor Supervisor</h1>
<p class="text-slate-500 mb-6">Selamat datang, ${user!.name}${user!.is_principal ? " (Kepala Sekolah)" : ""}.</p>
<div class="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
  ${statCard("Guru yang ditugaskan", ids.length, user!.is_principal ? "Kepala Sekolah: semua guru" : "sesuai penugasan admin")}
  ${statCard("Templat aktif", templates[0]?.c ?? 0, "instrumen supervisi")}
  ${statCard("Sesi supervisi", 0, "dibangun pada Fase 2")}
</div>
${card("Guru yang Anda supervisi", ids.length === 0
  ? `<p class="text-sm text-slate-500">Belum ada penugasan. Hubungi admin.</p>`
  : `<ul class="text-sm text-slate-700 space-y-1">${(await pool.query<(RowDataPacket & { id: number; name: string; username: string })[]>("SELECT id, name, username FROM users WHERE id IN (?) ORDER BY name", [ids.length ? ids : [0]]))[0].map((g) => `<li>· ${g.name} <span class="text-slate-400">(${g.username})</span></li>`).join("")}</ul>`)}`;
    } else {
      body = `
<h1 class="text-2xl font-bold text-slate-900 mb-1">Dasbor Guru</h1>
<p class="text-slate-500 mb-6">Selamat datang, ${user!.name}.</p>
${card(
  "Supervisi Anda",
  `<p class="text-sm text-slate-700">Hasil supervisi dan pengisian refleksi pasca-observasi akan tampil di sini setelah sesi supervisi dibuat (Fase 2). Untuk saat ini belum ada sesi supervisi.</p>
  ${alertBox("info", "Guru hanya dapat melihat hasil supervisi atas dirinya sendiri.")}`,
)}`;
    }

    return new Response(
      layout({ title: "Dasbor", user: user!, schoolName, body, active: "dasbor" }),
      { headers: { "Content-Type": "text/html; charset=utf-8" } },
    );
  },
);
