import { Elysia } from "elysia";
import type { RowDataPacket } from "mysql2/promise";
import { getPool } from "../db";
import { authPlugin, requireAuth } from "./auth";
import { alertBox, card, esc, layout, statCard } from "../views";
import { supervisedTeacherIds } from "../rbac";
import { STAGE_LABEL, listSessionsForUser } from "../lib/sessions";

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
      const [guru, kelas, supervisor, templat, periode, sesi] = await Promise.all([
        one("SELECT COUNT(*) AS c FROM users WHERE role = 'guru'"),
        one("SELECT COUNT(*) AS c FROM classes"),
        one("SELECT COUNT(*) AS c FROM users WHERE role = 'supervisor'"),
        one("SELECT COUNT(*) AS c FROM templates"),
        one("SELECT COUNT(*) AS c FROM periods WHERE is_active = 1"),
        one("SELECT COUNT(*) AS c FROM sessions"),
      ]);
      const recentSessions = await listSessionsForUser(pool, user!);
      const [activePeriodRows] = await pool.query<(RowDataPacket & { id: number })[]>(
        "SELECT id FROM periods WHERE is_active = 1 ORDER BY id LIMIT 1",
      );
      const activePeriodId = activePeriodRows[0]?.id;
      body = `
<h1 class="text-2xl font-bold text-slate-900 mb-1">Dasbor Admin</h1>
<p class="text-slate-500 mb-6">Selamat datang, ${user!.name}. Kelola data dasar supervisi dari sini.</p>
<div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
  ${statCard("Guru", guru, "akun guru terdaftar")}
  ${statCard("Kelas", kelas, "kelas pada semua periode")}
  ${statCard("Supervisor", supervisor, "akun supervisor")}
  ${statCard("Sesi supervisi", sesi, "semua sesi")}
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
    "Sesi supervisi terbaru",
    recentSessions.length === 0
      ? `<p class="text-sm text-slate-500">Belum ada sesi supervisi.</p>`
      : `<ul class="text-sm space-y-1">${recentSessions.slice(0, 8).map((s) => `<li>· <a class="text-teal-700 font-semibold underline" href="/supervisi/${s.id}">${esc(s.teacher_name)}</a> — ${esc(s.class_name)}, ${STAGE_LABEL[s.status]} <span class="text-slate-400">(${esc(s.supervisor_name)})</span></li>`).join("")}</ul>
         <p class="mt-3"><a class="text-teal-700 font-semibold underline text-sm" href="/supervisi">Lihat semua sesi →</a></p>`,
  )}
  ${activePeriodId ? card(
    "Rekap sekolah",
    `<p class="text-sm text-slate-600 mb-2">Rata-rata per elemen, distribusi predikat, dan guru yang belum disupervisi pada periode aktif.</p>
     <p><a class="text-teal-700 font-semibold underline text-sm" href="/rekap/periode/${activePeriodId}">Lihat rekap periode aktif →</a></p>`,
  ) : ""}
</div>`;
    } else if (user!.role === "supervisor") {
      const ids = await supervisedTeacherIds(pool, user!);
      const [templates] = await pool.query<(RowDataPacket & { c: number })[]>(
        "SELECT COUNT(*) AS c FROM templates WHERE status = 'aktif'",
      );
      const [predikatRows] = await pool.query<(RowDataPacket & { id: number; title: string })[]>(
        "SELECT id, title FROM templates WHERE status IN ('draf', 'aktif') ORDER BY title",
      );
      const predikatTemplates = predikatRows as { id: number; title: string }[];
      const allSessions = await listSessionsForUser(pool, user!);
      const mySessions = allSessions.filter((s) => s.supervisor_id === user!.id);
      const [activePeriod] = await pool.query<(RowDataPacket & { id: number })[]>(
        "SELECT id FROM periods WHERE is_active = 1 ORDER BY id LIMIT 1",
      );
      const supervisedInPeriod = new Set(
        mySessions.filter((s) => activePeriod[0] && s.period_id === activePeriod[0].id).map((s) => s.teacher_id),
      );
      const [assignedTeachers] = await pool.query<(RowDataPacket & { id: number; name: string; username: string })[]>(
        ids.length > 0
          ? `SELECT id, name, username FROM users WHERE id IN (${ids.map(() => "?").join(",")}) ORDER BY name`
          : "SELECT id, name, username FROM users WHERE 1 = 0",
        ids,
      );
      const notYetSupervised = assignedTeachers.filter((g) => !supervisedInPeriod.has(g.id));
      body = `
<h1 class="text-2xl font-bold text-slate-900 mb-1">Dasbor Supervisor</h1>
<p class="text-slate-500 mb-6">Selamat datang, ${user!.name}${user!.is_principal ? " (Kepala Sekolah)" : ""}.</p>
<div class="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
  ${statCard("Guru yang ditugaskan", ids.length, user!.is_principal ? "Kepala Sekolah: semua guru" : "sesuai penugasan admin")}
  ${statCard("Templat aktif", templates[0]?.c ?? 0, "instrumen supervisi")}
  ${statCard("Sesi supervisi saya", mySessions.length, "yang Anda buat")}
</div>
<div class="grid md:grid-cols-2 gap-4">
${card(
  "Sesi supervisi saya",
  mySessions.length === 0
    ? `<p class="text-sm text-slate-500">Belum ada sesi. <a class="text-teal-700 font-semibold underline" href="/supervisi/baru">Buat sesi baru →</a></p>`
    : `<ul class="text-sm space-y-1">${mySessions.slice(0, 8).map((s) => `<li>· <a class="text-teal-700 font-semibold underline" href="/supervisi/${s.id}">${esc(s.teacher_name)}</a> — ${esc(s.class_name)}, ${STAGE_LABEL[s.status]}</li>`).join("")}</ul>
       <p class="mt-3"><a class="text-teal-700 font-semibold underline text-sm" href="/supervisi/baru">+ Buat sesi baru</a></p>`,
)}
${card(
  "Guru yang belum disupervisi (periode aktif)",
  assignedTeachers.length === 0
    ? `<p class="text-sm text-slate-500">Belum ada penugasan. Hubungi admin.</p>`
    : notYetSupervised.length === 0
      ? `<p class="text-sm text-emerald-700">Semua guru yang ditugaskan sudah pernah disupervisi pada periode aktif ini.</p>`
      : `<ul class="text-sm text-slate-700 space-y-1">${notYetSupervised.map((g) => `<li>· <a class="text-teal-700 font-semibold underline" href="/guru/${g.id}">${esc(g.name)}</a> <span class="text-slate-400">(${esc(g.username)})</span> — <a class="text-teal-700 underline" href="/rekap/guru/${g.id}">Rekap</a></li>`).join("")}</ul>`,
)}
</div>
<div class="mt-4">
${card("Profil & rekap guru", assignedTeachers.length === 0
  ? `<p class="text-sm text-slate-500">Belum ada penugasan. Hubungi admin.</p>`
  : `<ul class="text-sm space-y-1">${assignedTeachers.map((g) => `<li>· <a class="text-teal-700 font-semibold underline" href="/guru/${g.id}">${esc(g.name)}</a> — <a class="text-teal-700 underline" href="/rekap/guru/${g.id}">Rekap per periode</a></li>`).join("")}</ul>`)}
</div>
<div class="mt-4">
${card("Predikat templat", predikatTemplates.length === 0
  ? `<p class="text-sm text-slate-500">Belum ada templat.</p>`
  : `<p class="text-sm text-slate-600 mb-2">Rentang predikat bisa diubah oleh supervisor — perubahan hanya berlaku untuk sesi baru.</p>
     <ul class="text-sm space-y-1">${predikatTemplates.map((t) => `<li>· ${esc(t.title)} — <a class="text-teal-700 font-semibold underline" href="/templat/${t.id}/predikat">Ubah predikat</a></li>`).join("")}</ul>`)}
</div>`;
    } else {
      const mySessions = await listSessionsForUser(pool, user!);
      const waiting = mySessions.filter((s) => s.status === "pasca");
      body = `
<h1 class="text-2xl font-bold text-slate-900 mb-1">Dasbor Guru</h1>
<p class="text-slate-500 mb-6">Selamat datang, ${user!.name}.</p>
${waiting.length > 0 ? alertBox("info", `Ada ${waiting.length} sesi yang menunggu refleksi Anda. Buka sesi di bawah dan isi refleksi pasca-observasi.`) : ""}
${card(
  "Supervisi Anda",
  mySessions.length === 0
    ? `<p class="text-sm text-slate-500">Belum ada sesi supervisi atas Anda.</p>`
    : `<ul class="text-sm space-y-2">${mySessions.map((s) => `<li>· <a class="text-teal-700 font-semibold underline" href="/supervisi/${s.id}">${esc(s.supervisor_name)}</a> — ${esc(s.class_name)}, ${esc(s.subject_theme ?? "")} (${esc(s.observed_at)}) — <b>${STAGE_LABEL[s.status]}</b>${s.status === "pasca" ? ` <span class="ml-1 px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-xs font-semibold">Menunggu refleksi Anda</span>` : ""}</li>`).join("")}</ul>`,
)}
<p class="text-sm text-slate-500 mt-4">Guru hanya dapat melihat hasil supervisi atas dirinya sendiri.</p>
<p class="text-sm mt-2"><a class="text-teal-700 font-semibold underline" href="/guru/${user!.id}">Profil perkembangan saya →</a> · <a class="text-teal-700 font-semibold underline" href="/rekap/guru/${user!.id}">Rekap saya per periode →</a></p>`;
    }

    return new Response(
      layout({ title: "Dasbor", user: user!, schoolName, body, active: "dasbor" }),
      { headers: { "Content-Type": "text/html; charset=utf-8" } },
    );
  },
);
