import { Elysia } from "elysia";
import type { RowDataPacket } from "mysql2/promise";
import { getPool } from "../db";
import { authPlugin, redirectTo, requireAuth } from "./auth";
import { isSupervisor } from "../rbac";
import { alertBox, btnGhost, card, esc, layout, statCard } from "../views";
import { getKopSettings, kopBlock, REKAP_PRINT_CSS } from "../lib/kop";
import {
  activePeriod,
  canViewClassRecap,
  canViewTeacher,
  classRecap,
  indicatorDistribution,
  listPeriods,
  loadTeacher,
  periodRecap,
  teacherPeriodScore,
  teacherProfile,
  trendSvg,
  viewScopeTeacherIds,
  type SessionSummary,
} from "../lib/recap";

function html(
  user: NonNullable<Parameters<typeof layout>[0]["user"]>,
  schoolName: string,
  body: string,
  active: string,
  title = "Profil & Rekap",
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

function sessionRows(sessions: SessionSummary[], showTeacher = false): string {
  return `<ul class="text-sm space-y-1.5">${sessions
    .map(
      (s) =>
        `<li class="flex flex-wrap justify-between gap-2 border-b border-slate-100 pb-1.5">` +
        `<span><a class="text-teal-700 font-semibold underline" href="/supervisi/${s.id}">${esc(s.subject_theme ?? "Supervisi")}</a>` +
        `${showTeacher ? ` — ${esc(s.teacher_name)}` : ""} · ${esc(s.class_name)} · ${esc(s.observed_at)}</span>` +
        `<span><b>${s.final100 === null ? "—" : s.final100.toFixed(1)}</b> / 100 · ${esc(s.predicate)}</span></li>`,
    )
    .join("")}</ul>`;
}

export const profileRoutes = new Elysia()
  .use(authPlugin)
  .onBeforeHandle(requireAuth)

  // ---------- Profil guru ----------
  .get("/guru/:id", async ({ user, params, query }: any) => {
    const teacherId = Number(params.id);
    const pool = getPool();
    if (!(await canViewTeacher(pool, user!, teacherId))) {
      return new Response("Anda tidak berhak melihat profil guru ini.", { status: 403 });
    }
    const school = await schoolName();
    const periods = await listPeriods(pool);
    const active = await activePeriod(pool);
    const periodId = Number((query as Record<string, string>).periode ?? "") || active?.id || periods[0]?.id;
    if (!periodId) return new Response("Belum ada periode.", { status: 404 });
    const { teacher, completed, inProgress, periodScore, distribution } = await teacherProfile(
      pool,
      teacherId,
      periodId,
    );
    const periodName = periods.find((p) => p.id === periodId)?.name ?? "";
    const trendPoints = completed
      .filter((s) => s.final100 !== null)
      .map((s) => ({
        date: s.observed_at,
        score100: s.final100 as number,
        label: `${s.subject_theme ?? "Supervisi"} — ${s.observed_at} — nilai ${(s.final100 as number).toFixed(1)} (${s.predicate})`,
      }));
    const distByIndicator = new Map<string, { element_title: string; text: string; labels: { label: string; count: number }[] }>();
    for (const d of distribution) {
      const key = `${d.element_code}|${d.indicator_text}`;
      const g = distByIndicator.get(key) ?? { element_title: d.element_title, text: d.indicator_text, labels: [] };
      g.labels.push({ label: d.label, count: d.count });
      distByIndicator.set(key, g);
    }
    return html(
      user!,
      school,
      `<div class="flex flex-wrap items-start justify-between gap-3 mb-2">
         <h1 class="text-2xl font-bold text-slate-900">Profil ${esc(teacher.name)}</h1>
         <a href="/rekap/guru/${teacher.id}" class="${btnGhost}">Rekap per Periode →</a>
       </div>
       <p class="text-slate-600 mb-4">@${esc(teacher.username)}${teacher.nip ? ` · NIP ${esc(teacher.nip)}` : ""} · ${completed.length} sesi selesai, ${inProgress.length} dalam proses</p>
       ${card(
         "Tren skor (sesi selesai)",
         trendPoints.length === 0
           ? `<p class="text-sm text-slate-500">Belum ada sesi selesai — tren muncul setelah ada sesi yang ditandai selesai.</p>`
           : trendSvg(trendPoints) +
             `<p class="text-xs text-slate-500 mt-1">Arahkan kursor ke titik untuk melihat tema dan nilai. Sumbu-x tanggal observasi, sumbu-y skor 0–100.</p>`,
       )}
       <div class="grid md:grid-cols-2 gap-4 mt-4">
       ${card(
         `Skor periode ${esc(periodName)}`,
         periodScore.count === 0
           ? `<p class="text-sm text-slate-500">Belum ada sesi selesai pada periode ini.</p>`
           : `<p class="text-sm mb-3">Rata-rata nilai akhir: <b class="text-lg">${periodScore.average!.toFixed(1)}</b> / 100 dari ${periodScore.count} sesi selesai.</p>${sessionRows(periodScore.sessions)}` +
             `<p class="text-xs text-slate-500 mt-3">Rata-rata di atas selalu dibaca bersama rincian per sesi dan predikat masing-masing.</p>`,
       )}
       ${card(
         `Distribusi per indikator (periode ${esc(periodName)})`,
         distByIndicator.size === 0
           ? `<p class="text-sm text-slate-500">Belum ada sesi selesai pada periode ini.</p>`
           : `<ul class="text-sm space-y-3">${[...distByIndicator.values()]
               .map(
                 (g) =>
                   `<li><p class="font-semibold">${esc(g.element_title)} — ${esc(g.text)}</p>` +
                   `<p class="text-slate-600">${g.labels.map((l) => `${esc(l.label)}: <b>${l.count}×</b>`).join(" · ")}</p></li>`,
               )
               .join("")}</ul>`,
       )}
       </div>
       <div class="mt-4">${card(
         "Semua sesi",
         completed.length === 0 && inProgress.length === 0
           ? `<p class="text-sm text-slate-500">Belum ada sesi supervisi.</p>`
           : (completed.length > 0 ? `<h3 class="text-sm font-bold text-slate-700 mb-2">Selesai</h3>${sessionRows(completed)}` : "") +
             (inProgress.length > 0
               ? `<h3 class="text-sm font-bold text-slate-700 mt-4 mb-2">Dalam proses (tanpa skor)</h3><ul class="text-sm space-y-1.5">${inProgress
                   .map(
                     (s) =>
                       `<li>· <a class="text-teal-700 font-semibold underline" href="/supervisi/${s.id}">${esc(s.subject_theme ?? "Supervisi")}</a> — ${esc(s.class_name)} · ${esc(s.observed_at)} — ${esc(s.status)}</li>`,
                   )
                   .join("")}</ul>`
               : ""),
       )}</div>
       <p class="text-sm text-slate-500 mt-4">Periode: ${periods
         .map(
           (p) =>
             `<a href="/guru/${teacher.id}?periode=${p.id}" class="${p.id === periodId ? "font-bold text-teal-700" : "text-teal-700 underline"}">${esc(p.name)}</a>`,
         )
         .join(" · ")}</p>`,
      "supervisi",
      `Profil ${teacher.name}`,
    );
  })

  // ---------- Rekap (pintu masuk menu) ----------
  .get("/rekap", async ({ user }: any) => {
    const pool = getPool();
    const active = await activePeriod(pool);
    if (!active) {
      return html(
        user!,
        await schoolName(),
        `<h1 class="text-2xl font-bold text-slate-900 mb-4">Rekap</h1>
         ${alertBox("info", "Belum ada periode aktif. Buat dan aktifkan periode dulu, lalu buka lagi menu Rekap.")}
         <p><a href="/" class="${btnGhost}">← Dasbor</a></p>`,
        "rekap",
        "Rekap",
      );
    }
    return redirectTo(`/rekap/periode/${active.id}`);
  })

  // ---------- Rekap satu guru per periode ----------
  .get("/rekap/guru/:id", async ({ user, params }: any) => {
    const teacherId = Number(params.id);
    const pool = getPool();
    if (!(await canViewTeacher(pool, user!, teacherId))) {
      return new Response("Anda tidak berhak melihat rekap guru ini.", { status: 403 });
    }
    const kopSt = await getKopSettings(pool);
    const school = kopSt.school_name;
    const teacher = await loadTeacher(pool, teacherId);
    if (!teacher) return new Response("Guru tidak ditemukan.", { status: 404 });
    const periods = await listPeriods(pool);
    const perPeriod: { name: string; average: number | null; count: number; sessions: SessionSummary[] }[] = [];
    for (const p of periods) {
      const score = await teacherPeriodScore(pool, teacherId, p.id);
      if (score.count > 0) perPeriod.push({ name: p.name, ...score });
    }
    return html(
      user!,
      school,
      `${REKAP_PRINT_CSS}
       <div class="kop-cetak">${kopBlock(kopSt)}</div>
       <div class="flex flex-wrap items-start justify-between gap-3 mb-1">
         <h1 class="text-2xl font-bold text-slate-900">Rekap ${esc(teacher.name)}</h1>
         <button type="button" onclick="window.print()" class="${btnGhost} no-print">🖨 Cetak / Simpan PDF</button>
       </div>
       <p class="text-slate-600 mb-4">@${esc(teacher.username)} · rata-rata per periode (sesi selesai saja), selalu bersama rincian per sesi.</p>
       ${perPeriod.length === 0 ? `<p class="text-sm text-slate-500">Belum ada sesi selesai.</p>` : ""}
       <div class="space-y-4">
       ${perPeriod
         .map(
           (pp) => card(
             `Periode ${esc(pp.name)}`,
             `<p class="text-sm mb-3">Rata-rata nilai akhir: <b class="text-lg">${pp.average!.toFixed(1)}</b> / 100 dari ${pp.count} sesi selesai.</p>${sessionRows(pp.sessions)}`,
           ),
         )
         .join("")}
       </div>
       <p class="mt-4 no-print"><a href="/guru/${teacher.id}" class="${btnGhost}">← Profil ${esc(teacher.name)}</a></p>`,
      "rekap",
      `Rekap ${teacher.name}`,
    );
  })

  // ---------- Rekap sekolah per periode ----------
  .get("/rekap/periode/:id", async ({ user, params }: any) => {
    const periodId = Number(params.id);
    const pool = getPool();
    const scope = await viewScopeTeacherIds(pool, user!);
    const kopSt = await getKopSettings(pool);
    const school = kopSt.school_name;
    let recap;
    try {
      recap = await periodRecap(pool, periodId, scope);
    } catch (err: any) {
      return new Response(err.message ?? "Periode tidak ditemukan.", { status: 404 });
    }
    const scopeNote =
      scope === null
        ? ""
        : isSupervisor(user!)
          ? `<p class="text-sm text-slate-500 mb-4">Rekap ini hanya mencakup guru yang ditugaskan kepada Anda.</p>`
          : `<p class="text-sm text-slate-500 mb-4">Rekap ini hanya mencakup sesi atas diri Anda.</p>`;
    const classIds = [...new Set(recap.sessions.map((s) => s.class_id))];
    return html(
      user!,
      school,
      `${REKAP_PRINT_CSS}
       <div class="kop-cetak">${kopBlock(kopSt)}</div>
       <div class="flex flex-wrap items-start justify-between gap-3 mb-1">
         <h1 class="text-2xl font-bold text-slate-900">Rekap Sekolah — ${esc(recap.period.name)}</h1>
         <button type="button" onclick="window.print()" class="${btnGhost} no-print">🖨 Cetak / Simpan PDF</button>
       </div>
       <p class="text-slate-600 mb-2">${recap.completedCount} sesi selesai pada periode ini.</p>
       ${scopeNote}
       <div class="grid md:grid-cols-2 gap-4 mb-4">
       ${card(
         "Rata-rata nilai akhir per elemen",
         recap.elementAverages.length === 0
           ? `<p class="text-sm text-slate-500">Belum ada sesi selesai.</p>`
           : `<ul class="text-sm space-y-1">${recap.elementAverages
               .map(
                 (e) =>
                   `<li class="flex justify-between"><span>${esc(e.element_title)}</span><b>${e.avg100.toFixed(1)} / 100 <span class="font-normal text-slate-400">(${e.sessions} sesi)</span></b></li>`,
               )
               .join("")}</ul>
              <p class="text-xs text-slate-500 mt-3">Rata-rata keseluruhan: <b>${recap.averageFinal === null ? "—" : recap.averageFinal.toFixed(1)}</b> / 100.</p>`,
       )}
       ${card(
         "Distribusi predikat",
         recap.predicateDistribution.length === 0
           ? `<p class="text-sm text-slate-500">Belum ada sesi selesai.</p>`
           : `<ul class="text-sm space-y-1">${recap.predicateDistribution
               .map(
                 (d) =>
                   `<li class="flex justify-between"><span>${esc(d.label)}</span><b>${d.count} sesi</b></li>`,
               )
               .join("")}</ul>`,
       )}
       </div>
       ${card(
         "Sesi selesai pada periode ini",
         recap.sessions.length === 0
           ? `<p class="text-sm text-slate-500">Belum ada sesi selesai.</p>`
           : sessionRows(recap.sessions, true),
       )}
       ${recap.unsupervised !== null && (user!.role === "admin" || isSupervisor(user!))
         ? `<div class="mt-4">${card(
             "Guru yang belum disupervisi (periode aktif)",
             recap.unsupervised.length === 0
               ? `<p class="text-sm text-emerald-700">Semua guru sudah pernah disupervisi pada periode aktif ini.</p>`
               : `<ul class="text-sm space-y-1">${recap.unsupervised
                   .map(
                     (g) =>
                       `<li>· <a class="text-teal-700 font-semibold underline" href="/guru/${g.id}">${esc(g.name)}</a> <span class="text-slate-400">(${esc(g.username)})</span></li>`,
                   )
                   .join("")}</ul>`,
           )}</div>`
         : ""}
       ${classIds.length > 0 ? `<p class="text-sm text-slate-500 mt-4 no-print">Rekap per kelas: ${classIds.map((cid) => { const s = recap.sessions.find((x) => x.class_id === cid)!; return `<a class="text-teal-700 underline" href="/rekap/kelas/${cid}">${esc(s.class_name)}</a>`; }).join(" · ")}</p>` : ""}`,
      "rekap",
      `Rekap ${recap.period.name}`,
    );
  })

  // ---------- Rekap kelas ----------
  .get("/rekap/kelas/:id", async ({ user, params }: any) => {
    const classId = Number(params.id);
    const pool = getPool();
    if (!(await canViewClassRecap(pool, user!, classId))) {
      return new Response("Anda tidak berhak melihat rekap kelas ini.", { status: 403 });
    }
    const kopSt = await getKopSettings(pool);
    const school = kopSt.school_name;
    const scope = await viewScopeTeacherIds(pool, user!);
    let recap;
    try {
      recap = await classRecap(pool, classId, scope);
    } catch (err: any) {
      return new Response(err.message ?? "Kelas tidak ditemukan.", { status: 404 });
    }
    return html(
      user!,
      school,
      `${REKAP_PRINT_CSS}
       <div class="kop-cetak">${kopBlock(kopSt)}</div>
       <div class="flex flex-wrap items-start justify-between gap-3 mb-1">
         <h1 class="text-2xl font-bold text-slate-900">Rekap Kelas ${esc(recap.className)}</h1>
         <button type="button" onclick="window.print()" class="${btnGhost} no-print">🖨 Cetak / Simpan PDF</button>
       </div>
       <p class="text-slate-600 mb-4">Periode ${esc(recap.period.name)} · ${recap.completedCount} sesi selesai.</p>
       ${recap.averageFinal === null
         ? `<p class="text-sm text-slate-500">Belum ada sesi selesai di kelas ini.</p>`
         : `<p class="text-sm mb-4">Rata-rata nilai akhir kelas: <b class="text-lg">${recap.averageFinal.toFixed(1)}</b> / 100.</p>`}
       <div class="space-y-4">
       ${recap.perTeacher
         .map(
           (t) => card(
             `${esc(t.teacher_name)} — rata-rata ${t.average.toFixed(1)} / 100`,
             sessionRows(t.sessions),
           ),
         )
         .join("")}
       </div>
       <p class="mt-4 no-print"><a href="/rekap/periode/${recap.period.id}" class="${btnGhost}">← Rekap Sekolah ${esc(recap.period.name)}</a></p>`,
      "rekap",
      `Rekap Kelas ${recap.className}`,
    );
  });
