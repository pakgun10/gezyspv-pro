import { Elysia } from "elysia";
import { getPool } from "../db";
import { authPlugin, requireAdmin, requireAuth } from "./auth";
import { isSupervisor, supervisedTeacherIds } from "../rbac";
import {
  addTemplateToGroup,
  canViewSessionGroup,
  createGroup,
  createGroupSession,
  deleteGroup,
  getGroup,
  listGroups,
  loadSessionGroup,
  removeTemplateFromGroup,
  reorderGroupItems,
  updateGroup,
} from "../lib/groups";
import { finalScore100, predicateFor } from "../lib/scores";
import { loadSnapshot, STAGE_LABEL } from "../lib/sessions";
import type { RowDataPacket } from "mysql2/promise";
import {
  alertBox,
  btnDanger,
  btnGhost,
  btnPrimary,
  esc,
  inputCls,
  labelCls,
  layout,
} from "../views";

/**
 * Route kelompok templat & supervisi berkelompok (keputusan Pak Gun
 * 2026-11-06, opsi B).
 *
 * Dua instance:
 * - templateGroupAdminRoutes (guard requireAdmin): kelola kelompok
 *   templat (buat, tambah/hapus templat, urutan, hapus kelompok).
 * - sessionGroupRoutes (guard requireAuth): buat supervisi
 *   berkelompok (supervisor) + ringkasan kelompok (hak lihat sama
 *   dengan sesi: admin/Kepsek/pembuat/yang disupervisi).
 */

function html(
  user: NonNullable<Parameters<typeof layout>[0]["user"]>,
  schoolName: string,
  body: string,
  active: string,
  title = "Kelompok Templat",
): Response {
  return new Response(layout({ title, user, schoolName, body, active }), {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

async function schoolName(): Promise<string> {
  const [rows] = await getPool().query<(RowDataPacket & { school_name: string })[]>(
    "SELECT school_name FROM settings WHERE id = 1",
  );
  return rows[0]?.school_name ?? "SMPN 1 Punggur";
}

function msgFromQuery(query: Record<string, string | undefined>): string {
  if (query.ok) return decodeURIComponent(query.ok);
  if (query.err) return decodeURIComponent(query.err);
  return "";
}

function redir(location: string): Response {
  return new Response(null, { status: 302, headers: { Location: location } });
}

function redirOk(location: string, msg: string): Response {
  return redir(`${location}${location.includes("?") ? "&" : "?"}ok=${encodeURIComponent(msg)}`);
}

function redirErr(location: string, msg: string): Response {
  return redir(`${location}${location.includes("?") ? "&" : "?"}err=${encodeURIComponent(msg)}`);
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

/** Jalankan aksi service; Error berisi pesan ramah → redirect ?err=. */
async function attempt(fn: () => Promise<void>, okLoc: string, okMsg: string, errLoc: string): Promise<Response> {
  try {
    await fn();
    return redirOk(okLoc, okMsg);
  } catch (err) {
    return redirErr(errLoc, err instanceof Error ? err.message : "Terjadi kesalahan.");
  }
}

// ---------- Instance admin ----------

export const templateGroupAdminRoutes = new Elysia().use(authPlugin).onBeforeHandle(requireAdmin)
  .get("/admin/kelompok", async ({ user, query }: any) => {
    const school = await schoolName();
    const groups = await listGroups(getPool());
    const msg = msgFromQuery(query as Record<string, string>);
    const rows = groups
      .map(
        (g) => `<tr class="border-t border-slate-100">
          <td class="py-2 pr-2"><a class="text-indigo-700 font-medium hover:underline" href="/admin/kelompok/${g.id}">${esc(g.title)}</a></td>
          <td class="py-2 pr-2">${esc(g.description ?? "")}</td>
          <td class="py-2">${g.template_count} templat</td>
        </tr>`,
      )
      .join("");
    return html(
      user!,
      school,
      `<h1 class="text-2xl font-bold text-slate-900 mb-6">Kelompok Templat</h1>
       ${msg ? alertBox(query.ok ? "ok" : "err", msg) : ""}
       <p class="text-sm text-slate-500 mb-4">Satu kelompok berisi beberapa templat yang selalu disupervisi bersama (mis. 4 instrumen Kurikulum Merdeka). Satu supervisi berkelompok membuka satu sesi per templat, masing-masing dengan Nilai Akhir + predikat sendiri.</p>
       ${groups.length === 0 ? `<p class="text-slate-500 mb-6">Belum ada kelompok templat.</p>` : `<div class="overflow-x-auto mb-6"><table class="w-full text-sm text-left"><thead><tr class="text-slate-500"><th class="pr-2 pb-1">Kelompok</th><th class="pr-2 pb-1">Keterangan</th><th class="pb-1">Isi</th></tr></thead><tbody>${rows}</tbody></table></div>`}
       <form method="post" action="/admin/kelompok" class="space-y-4 max-w-lg border-t border-slate-200 pt-6">
         <h2 class="text-lg font-semibold text-slate-900">Buat kelompok baru</h2>
         <div><label class="${labelCls}" for="title">Nama kelompok</label>
           <input id="title" name="title" class="${inputCls}" placeholder="mis. Instrumen Supervisi Kurikulum Merdeka" required></div>
         <div><label class="${labelCls}" for="description">Keterangan</label>
           <textarea id="description" name="description" rows="2" class="${inputCls}" placeholder="Paket instrumen apa saja yang ada di kelompok ini"></textarea></div>
         <button class="${btnPrimary}">Buat Kelompok</button>
       </form>`,
      "kelompok",
    );
  })
  .post("/admin/kelompok", async ({ body }: any) => {
    return attempt(
      async () => {
        await createGroup(getPool(), String(body?.title ?? ""), String(body?.description ?? ""));
      },
      "/admin/kelompok",
      "Kelompok dibuat.",
      "/admin/kelompok",
    );
  })
  .get("/admin/kelompok/:id", async ({ user, params, query }: any) => {
    const school = await schoolName();
    const pool = getPool();
    const g = await getGroup(pool, Number(params.id));
    if (!g) return new Response("Kelompok tidak ditemukan.", { status: 404 });
    const [freeTpls] = await pool.query<(RowDataPacket & { id: number; title: string; score_scale: number })[]>(
      `SELECT id, title, score_scale FROM templates WHERE status = 'aktif'
       AND id NOT IN (SELECT template_id FROM template_group_items)
       ORDER BY title`,
    );
    const msg = msgFromQuery(query as Record<string, string>);
    const items = g.items
      .map(
        (it, i) => `<tr class="border-t border-slate-100">
          <td class="py-2 pr-2">${i + 1}</td>
          <td class="py-2 pr-2"><a class="text-indigo-700 font-medium hover:underline" href="/admin/templat/${it.template_id}">${esc(it.template_title)}</a></td>
          <td class="py-2 pr-2">${esc(it.template_basis ?? "")}</td>
          <td class="py-2 pr-2">Skala ${it.template_scale}</td>
          <td class="py-2 pr-2">${it.template_status}</td>
          <td class="py-2 pr-2">${it.indicator_count} indikator</td>
          <td class="py-2 whitespace-nowrap">
            <form method="post" action="/admin/kelompok/${g.id}/naik" class="inline"><input type="hidden" name="template_id" value="${it.template_id}"><button type="submit" class="${btnGhost}" ${i === 0 ? "disabled" : ""} title="Naik">↑</button></form>
            <form method="post" action="/admin/kelompok/${g.id}/turun" class="inline"><input type="hidden" name="template_id" value="${it.template_id}"><button type="submit" class="${btnGhost}" ${i === g.items.length - 1 ? "disabled" : ""} title="Turun">↓</button></form>
            <form method="post" action="/admin/kelompok/${g.id}/hapus-templat" class="inline" onsubmit="return confirm('Keluarkan templat ini dari kelompok?')"><input type="hidden" name="template_id" value="${it.template_id}"><button type="submit" class="${btnDanger}">Keluarkan</button></form>
          </td>
        </tr>`,
      )
      .join("");
    return html(
      user!,
      school,
      `<div class="flex items-center justify-between mb-6">
         <h1 class="text-2xl font-bold text-slate-900">${esc(g.title)}</h1>
         <a href="/admin/kelompok" class="${btnGhost}">← Semua Kelompok</a>
       </div>
       ${msg ? alertBox(query.ok ? "ok" : "err", msg) : ""}
       ${g.description ? `<p class="text-sm text-slate-500 mb-4">${esc(g.description)}</p>` : ""}
       <form method="post" action="/admin/kelompok/${g.id}" class="space-y-4 max-w-lg mb-8">
         <div><label class="${labelCls}" for="title">Nama kelompok</label>
           <input id="title" name="title" class="${inputCls}" value="${esc(g.title)}" required></div>
         <div><label class="${labelCls}" for="description">Keterangan</label>
           <textarea id="description" name="description" rows="2" class="${inputCls}">${esc(g.description ?? "")}</textarea></div>
         <button class="${btnPrimary}">Simpan</button>
       </form>
       <h2 class="text-lg font-semibold text-slate-900 mb-2">Templat di kelompok ini</h2>
       ${g.items.length === 0 ? `<p class="text-slate-500 mb-4">Kelompok ini masih kosong.</p>` : `<div class="overflow-x-auto mb-4"><table class="w-full text-sm text-left"><thead><tr class="text-slate-500"><th class="pr-2 pb-1">No</th><th class="pr-2 pb-1">Templat</th><th class="pr-2 pb-1">Basis</th><th class="pr-2 pb-1">Skala</th><th class="pr-2 pb-1">Status</th><th class="pr-2 pb-1">Indikator</th><th class="pb-1">Aksi</th></tr></thead><tbody>${items}</tbody></table></div>`}
       ${freeTpls.length > 0 ? `<form method="post" action="/admin/kelompok/${g.id}/tambah-templat" class="flex items-end gap-3 max-w-xl mb-8">
         <div class="flex-1"><label class="${labelCls}" for="template_id">Tambah templat aktif</label>
           <select id="template_id" name="template_id" class="${inputCls}" required>
             ${freeTpls.map((t) => `<option value="${t.id}">${esc(t.title)} — skala ${t.score_scale}</option>`).join("")}
           </select></div>
         <button class="${btnPrimary}">Tambah</button>
       </form>` : `<p class="text-sm text-slate-500 mb-8">Tidak ada templat aktif yang belum masuk kelompok. Templat draf/arsip tidak bisa masuk kelompok.</p>`}
       <p class="text-sm text-slate-500 mb-2">Templat di dalam kelompok tetap bisa diedit seperti templat biasa (sesi yang sudah dibuat memakai snapshot, jadi tidak berubah). Templat di dalam kelompok tidak bisa dihapus sebelum dikeluarkan.</p>
       <form method="post" action="/admin/kelompok/${g.id}/hapus" onsubmit="return confirm('Hapus kelompok ini? Templat di dalamnya tidak ikut terhapus.')">
         <button type="submit" class="${btnDanger}">Hapus Kelompok</button>
       </form>`,
      "kelompok",
    );
  })
  .post("/admin/kelompok/:id", async ({ params, body }: any) => {
    const id = Number(params.id);
    return attempt(
      () => updateGroup(getPool(), id, String(body?.title ?? ""), String(body?.description ?? "")),
      `/admin/kelompok/${id}`,
      "Kelompok disimpan.",
      `/admin/kelompok/${id}`,
    );
  })
  .post("/admin/kelompok/:id/tambah-templat", async ({ params, body }: any) => {
    const id = Number(params.id);
    return attempt(
      () => addTemplateToGroup(getPool(), id, num(body?.template_id)),
      `/admin/kelompok/${id}`,
      "Templat ditambahkan ke kelompok.",
      `/admin/kelompok/${id}`,
    );
  })
  .post("/admin/kelompok/:id/hapus-templat", async ({ params, body }: any) => {
    const id = Number(params.id);
    return attempt(
      () => removeTemplateFromGroup(getPool(), id, num(body?.template_id)),
      `/admin/kelompok/${id}`,
      "Templat dikeluarkan dari kelompok.",
      `/admin/kelompok/${id}`,
    );
  })
  .post("/admin/kelompok/:id/naik", async ({ params, body }: any) => {
    const id = Number(params.id);
    const templateId = num(body?.template_id);
    return attempt(
      async () => {
        const g = await getGroup(getPool(), id);
        if (!g) throw new Error("Kelompok tidak ditemukan.");
        const order = g.items.map((it) => it.template_id);
        const i = order.indexOf(templateId);
        if (i > 0) {
          [order[i - 1], order[i]] = [order[i]!, order[i - 1]!];
          await reorderGroupItems(getPool(), id, order);
        }
      },
      `/admin/kelompok/${id}`,
      "Urutan diubah.",
      `/admin/kelompok/${id}`,
    );
  })
  .post("/admin/kelompok/:id/turun", async ({ params, body }: any) => {
    const id = Number(params.id);
    const templateId = num(body?.template_id);
    return attempt(
      async () => {
        const g = await getGroup(getPool(), id);
        if (!g) throw new Error("Kelompok tidak ditemukan.");
        const order = g.items.map((it) => it.template_id);
        const i = order.indexOf(templateId);
        if (i >= 0 && i < order.length - 1) {
          [order[i], order[i + 1]] = [order[i + 1]!, order[i]!];
          await reorderGroupItems(getPool(), id, order);
        }
      },
      `/admin/kelompok/${id}`,
      "Urutan diubah.",
      `/admin/kelompok/${id}`,
    );
  })
  .post("/admin/kelompok/:id/hapus", async ({ params }: any) => {
    const id = Number(params.id);
    return attempt(
      () => deleteGroup(getPool(), id),
      "/admin/kelompok",
      "Kelompok dihapus.",
      `/admin/kelompok/${id}`,
    );
  });

// ---------- Instance supervisi berkelompok ----------

export const sessionGroupRoutes = new Elysia().use(authPlugin).onBeforeHandle(requireAuth)
  .get("/supervisi/kelompok/baru", async ({ user, query }: any) => {
    if (!isSupervisor(user!)) {
      return new Response(null, { status: 302, headers: { Location: "/supervisi?err=" + encodeURIComponent("Hanya supervisor yang bisa membuat supervisi berkelompok.") } });
    }
    const pool = getPool();
    const school = await schoolName();
    const groups = (await listGroups(pool)).filter((g) => g.template_count > 0);
    const teacherIds = (await supervisedTeacherIds(pool, user!)).filter((id) => id !== user!.id);
    const [teachers] = await pool.query<(RowDataPacket & { id: number; name: string; username: string })[]>(
      teacherIds.length > 0
        ? `SELECT id, name, username FROM users WHERE id IN (${teacherIds.map(() => "?").join(",")}) ORDER BY name`
        : "SELECT id, name, username FROM users WHERE 1 = 0",
      teacherIds,
    );
    const [classes] = await pool.query<
      (RowDataPacket & { id: number; name: string; level_label: string | null; period_name: string })[]
    >(
      `SELECT c.id, c.name, c.level_label, p.name AS period_name
       FROM classes c JOIN periods p ON p.id = c.period_id
       WHERE p.is_active = 1 ORDER BY c.name`,
    );
    const msg = msgFromQuery(query as Record<string, string>);
    const today = new Date().toISOString().slice(0, 10);
    return html(
      user!,
      school,
      `<h1 class="text-2xl font-bold text-slate-900 mb-6">Buat Supervisi Berkelompok</h1>
       ${msg ? alertBox(query.ok ? "ok" : "err", msg) : ""}
       <p class="text-sm text-slate-500 mb-4">Satu supervisi berkelompok membuka satu sesi per templat di kelompok yang dipilih — semuanya dengan guru, kelas, tema, dan tanggal yang sama. Tiap sesi tetap diisi lewat alurnya masing-masing.</p>
       ${
         groups.length === 0
           ? `<p class="text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-4">Belum ada kelompok templat yang berisi templat. Minta admin membuat kelompok dulu di <a class="underline" href="/admin/kelompok">Kelompok Templat</a>.</p>`
           : teachers.length === 0
             ? `<p class="text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-4">Belum ada guru yang ditugaskan kepada Anda. ${user!.is_principal ? "" : "Minta admin mengatur penugasan Anda."}</p>`
             : `<form method="post" action="/supervisi/kelompok/baru" class="space-y-4 max-w-lg">
          <div><label class="${labelCls}" for="group_id">Kelompok templat</label>
            <select id="group_id" name="group_id" class="${inputCls}" required>
              ${groups.map((g) => `<option value="${g.id}">${esc(g.title)} — ${g.template_count} templat</option>`).join("")}
            </select></div>
          <div><label class="${labelCls}" for="teacher_id">Guru yang disupervisi</label>
            <select id="teacher_id" name="teacher_id" class="${inputCls}" required>
              ${teachers.map((t) => `<option value="${t.id}">${esc(t.name)} (@${esc(t.username)})</option>`).join("")}
            </select></div>
          <div><label class="${labelCls}" for="class_id">Kelas</label>
            <select id="class_id" name="class_id" class="${inputCls}" required>
              ${classes.map((c) => `<option value="${c.id}">${esc(c.name)}${c.level_label ? ` (${esc(c.level_label)})` : ""}</option>`).join("")}
            </select></div>
          <div><label class="${labelCls}" for="subject_theme">Tema / mata pelajaran</label>
            <input id="subject_theme" name="subject_theme" class="${inputCls}" placeholder="mis. Kurikulum Merdeka — Kelas 9" required></div>
          <div><label class="${labelCls}" for="phase_semester">Fase / semester</label>
            <input id="phase_semester" name="phase_semester" class="${inputCls}" placeholder="mis. Semester 1" required></div>
          <div class="grid grid-cols-2 gap-3">
            <div><label class="${labelCls}" for="observed_at">Tanggal observasi</label>
              <input id="observed_at" type="date" name="observed_at" value="${today}" class="${inputCls}" required></div>
            <div><label class="${labelCls}" for="observed_time">Waktu</label>
              <input id="observed_time" type="time" name="observed_time" class="${inputCls}"></div>
          </div>
          <button class="${btnPrimary}">Buat Supervisi Berkelompok</button>
          <a href="/supervisi" class="${btnGhost}">Batal</a>
        </form>`
       }`,
      "supervisi",
      "Buat Supervisi Berkelompok",
    );
  })
  .post("/supervisi/kelompok/baru", async ({ user, body }: any) => {
    if (!isSupervisor(user!)) return redirErr("/supervisi", "Hanya supervisor yang bisa membuat supervisi berkelompok.");
    try {
      const id = await createGroupSession(getPool(), user!, {
        groupId: Number(body?.group_id),
        teacherId: Number(body?.teacher_id),
        classId: Number(body?.class_id),
        subject_theme: String(body?.subject_theme ?? ""),
        phase_semester: String(body?.phase_semester ?? ""),
        observed_at: String(body?.observed_at ?? ""),
        observed_time: String(body?.observed_time ?? ""),
      });
      return redirOk(`/supervisi/kelompok/${id}`, "Supervisi berkelompok dibuat — satu sesi per templat sudah dibuka.");
    } catch (err: any) {
      return redirErr("/supervisi/kelompok/baru", err.message ?? "Gagal membuat supervisi berkelompok.");
    }
  })
  .get("/supervisi/kelompok/:id", async ({ user, params, query }: any) => {
    const pool = getPool();
    const sg = await loadSessionGroup(pool, Number(params.id));
    if (!sg) return new Response("Supervisi berkelompok tidak ditemukan.", { status: 404 });
    if (!canViewSessionGroup(user!, sg)) {
      return new Response("Anda tidak berhak melihat supervisi berkelompok ini.", { status: 403 });
    }
    const school = await schoolName();
    const [meta] = await pool.query<(RowDataPacket & { group_title: string; supervisor_name: string; teacher_name: string; class_name: string })[]>(
      `SELECT g.title AS group_title, sup.name AS supervisor_name, t.name AS teacher_name, c.name AS class_name
       FROM session_groups sg
       JOIN template_groups g ON g.id = sg.group_id
       JOIN users sup ON sup.id = sg.supervisor_id
       JOIN users t ON t.id = sg.teacher_id
       JOIN classes c ON c.id = sg.class_id
       WHERE sg.id = ?`,
      [sg.id],
    );
    const m = meta[0]!;
    const [sessions] = await pool.query<(RowDataPacket & { id: number; template_title: string; status: string; sort: number })[]>(
      `SELECT s.id, t.title AS template_title, s.status, gi.sort
       FROM sessions s
       JOIN templates t ON t.id = s.template_id
       JOIN template_group_items gi ON gi.template_id = s.template_id AND gi.group_id = ?
       WHERE s.session_group_id = ?
       ORDER BY gi.sort, s.id`,
      [sg.group_id, sg.id],
    );
    const msg = msgFromQuery(query as Record<string, string>);
    const rows: string[] = [];
    let finished = 0;
    for (const s of sessions) {
      if (s.status === "selesai") finished++;
      let score = "—";
      if (s.status === "selesai") {
        const snap = await loadSnapshot(pool, s.id);
        const final = finalScore100(
          snap.elements.flatMap((el) => el.indicators),
          snap.scaleLevels,
        );
        score =
          final === null
            ? "—"
            : `${final.toFixed(1)} / 100 — ${esc(predicateFor(final, snap.predicates))}`;
      }
      rows.push(`<tr class="border-t border-slate-100">
        <td class="py-2 pr-2"><a class="text-indigo-700 font-medium hover:underline" href="/supervisi/${s.id}">${esc(s.template_title)}</a></td>
        <td class="py-2 pr-2">${STAGE_LABEL[s.status as keyof typeof STAGE_LABEL] ?? esc(s.status)}</td>
        <td class="py-2 pr-2">${score}</td>
        <td class="py-2 whitespace-nowrap"><a href="/supervisi/${s.id}" class="${btnGhost}">Buka sesi →</a> <a href="/supervisi/${s.id}/cetak" class="${btnGhost}">🖨 Cetak</a></td>
      </tr>`);
    }
    const allDone = sessions.length > 0 && finished === sessions.length;
    return html(
      user!,
      school,
      `<div class="flex items-center justify-between mb-2">
         <h1 class="text-2xl font-bold text-slate-900">${esc(m.group_title)}</h1>
         <a href="/supervisi" class="${btnGhost}">← Semua Sesi</a>
       </div>
       <p class="text-sm text-slate-500 mb-4">Supervisor: ${esc(m.supervisor_name)} · Guru: ${esc(m.teacher_name)} · Kelas: ${esc(m.class_name)} · ${esc(sg.observed_at)}${sg.observed_time ? ` ${esc(sg.observed_time)}` : ""}${sg.subject_theme ? ` · ${esc(sg.subject_theme)}` : ""}${sg.phase_semester ? ` · ${esc(sg.phase_semester)}` : ""}</p>
       ${msg ? alertBox(query.ok ? "ok" : "err", msg) : ""}
       ${allDone ? `<p class="text-teal-800 bg-teal-50 border border-teal-200 rounded-lg p-4 mb-4">✓ Kelompok selesai — keempat sesi sudah selesai dan Nilai Akhirnya tampil di bawah.</p>` : `<p class="text-sm text-slate-500 mb-4">${finished} dari ${sessions.length} sesi selesai.</p>`}
       <div class="overflow-x-auto"><table class="w-full text-sm text-left">
         <thead><tr class="text-slate-500"><th class="pr-2 pb-1">Instrumen</th><th class="pr-2 pb-1">Status</th><th class="pr-2 pb-1">Nilai Akhir</th><th class="pb-1">Aksi</th></tr></thead>
         <tbody>${rows.join("")}</tbody></table></div>
       <p class="text-sm text-slate-500 mt-4">Nilai Akhir hanya tampil untuk sesi yang sudah selesai. Rekap guru dan rekap sekolah tetap menghitung per sesi (tidak digabung di sini).</p>`,
      "supervisi",
      "Ringkasan Kelompok",
    );
  });
