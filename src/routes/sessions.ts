import { Elysia } from "elysia";
import { getPool } from "../db";
import { authPlugin, requireAuth } from "./auth";
import { isSupervisor, supervisedTeacherIds } from "../rbac";
import type { RowDataPacket } from "mysql2/promise";
import {
  alertBox,
  btnDanger,
  btnGhost,
  btnPrimary,
  card,
  esc,
  inputCls,
  labelCls,
  layout,
} from "../views";
import {
  STAGES,
  STAGE_LABEL,
  canEditSession,
  canViewSession,
  checkCompletion,
  createSession,
  listSessionsForUser,
  loadSession,
  loadSessionDetail,
  loadSnapshot,
  savePascaGuru,
  savePascaSupervisor,
  savePra,
  saveRtl,
  saveScores,
  sessionProgress,
  setSessionStatus,
  type SessionDetail,
  type SessionStatus,
} from "../lib/sessions";
import { elementScores, finalScore100, predicateFor } from "../lib/scores";
import {
  canEditNarrative,
  getNarrativeForDisplay,
  regenerateNarrative,
  saveNarrative,
} from "../lib/narrative";
import {
  addVideoUrl,
  countPhotos,
  deleteEvidence,
  getEvidence,
  listEvidence,
  storePhoto,
  validatePhoto,
  validateVideoUrl,
  MAX_PHOTOS_PER_SESSION,
  evidenceDir,
} from "../lib/evidence";
import { readFile } from "node:fs/promises";
import path from "node:path";

function html(
  user: NonNullable<Parameters<typeof layout>[0]["user"]>,
  schoolName: string,
  body: string,
  active: string,
  title = "Supervisi",
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

function redirOk(to: string, msg: string): Response {
  return new Response(null, {
    status: 302,
    headers: { Location: `${to}?ok=${encodeURIComponent(msg)}` },
  });
}

function redirErr(to: string, msg: string): Response {
  return new Response(null, {
    status: 302,
    headers: { Location: `${to}?err=${encodeURIComponent(msg)}` },
  });
}

/**
 * Ambil isian form berkelompok `prefix[id]` dari body.
 * Elysia bisa mengembalikan kunci datar ("pra[3]") atau objek
 * bersarang ({ pra: { "3": ... } }); tangani keduanya.
 */
function grouped(body: any, prefix: string): Record<number, string> {
  const out: Record<number, string> = {};
  if (!body) return out;
  if (body[prefix] && typeof body[prefix] === "object") {
    for (const [k, v] of Object.entries(body[prefix])) out[Number(k)] = String(v ?? "");
    return out;
  }
  for (const [k, v] of Object.entries(body)) {
    const m = k.match(new RegExp(`^${prefix}\\[(\\d+)\\]$`));
    if (m) out[Number(m[1])] = String(v ?? "");
  }
  return out;
}

function stageStepper(s: SessionDetail): string {
  const cur = STAGES.indexOf(s.status);
  return `<ol class="flex flex-wrap gap-1 mb-6" aria-label="Tahapan sesi">
    ${STAGES.map((st, i) => {
      const done = i < cur;
      const active = i === cur;
      return `<li class="flex items-center">
        <a href="/supervisi/${s.id}${st === "selesai" ? "" : "/" + stagePath(st)}"
           class="px-3 py-2 rounded-full text-xs font-semibold ${
             active
               ? "bg-indigo-600 text-white"
               : done
                 ? "bg-emerald-100 text-emerald-800"
                 : "bg-slate-100 text-slate-500"
           }">${done ? "✓ " : ""}${i + 1}. ${STAGE_LABEL[st]}</a>
        ${i < STAGES.length - 1 ? `<span class="mx-1 text-slate-300">›</span>` : ""}
      </li>`;
    }).join("")}
  </ol>`;
}

function stagePath(st: SessionStatus): string {
  return st === "tindak_lanjut" ? "tindak-lanjut" : st;
}

function statusButtons(s: SessionDetail): string {
  const cur = STAGES.indexOf(s.status);
  const prev = cur > 0 ? STAGES[cur - 1] : null;
  const next = cur < STAGES.length - 1 ? STAGES[cur + 1] : null;
  if (s.status === "selesai") {
    return `<p class="text-sm text-emerald-700 font-semibold">✓ Sesi ini sudah selesai dan terkunci.</p>`;
  }
  return `<div class="flex flex-wrap gap-2">
    ${prev ? `<form method="post" action="/supervisi/${s.id}/status"><input type="hidden" name="target" value="${prev}"><button class="${btnGhost}">← Kembali ke ${STAGE_LABEL[prev]}</button></form>` : ""}
    ${next ? `<form method="post" action="/supervisi/${s.id}/status"><input type="hidden" name="target" value="${next}"><button class="${btnPrimary}">Lanjut ke ${STAGE_LABEL[next]} →</button></form>` : ""}
  </div>`;
}

async function loadOr404(id: number): Promise<SessionDetail | null> {
  return loadSessionDetail(getPool(), id);
}

export const sessionRoutes = new Elysia()
  .use(authPlugin)
  .onBeforeHandle(requireAuth)

  // ---------- Daftar sesi ----------
  .get("/supervisi", async ({ user, query }: any) => {
    const school = await schoolName();
    const sessions = await listSessionsForUser(getPool(), user!);
    const msg = msgFromQuery(query as Record<string, string>);
    const rows = sessions
      .map(
        (s) => `<tr class="border-t border-slate-100">
          <td class="py-2 pr-2"><a class="text-indigo-700 font-medium hover:underline" href="/supervisi/${s.id}">${esc(s.teacher_name)}</a></td>
          <td class="py-2 pr-2">${esc(s.class_name)}</td>
          <td class="py-2 pr-2">${esc(s.subject_theme ?? "")}</td>
          <td class="py-2 pr-2">${esc(s.observed_at)}${s.observed_time ? ` ${esc(s.observed_time)}` : ""}</td>
          <td class="py-2 pr-2">${STAGE_LABEL[s.status]}${s.status === "pasca" && s.teacher_id === user!.id ? ` <span class="ml-1 px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-xs font-semibold">Menunggu refleksi Anda</span>` : ""}</td>
          <td class="py-2">${esc(s.supervisor_name)}</td>
        </tr>`,
      )
      .join("");
    return html(
      user!,
      school,
      `<div class="flex items-center justify-between mb-6">
         <h1 class="text-2xl font-bold text-slate-900">Sesi Supervisi</h1>
         ${isSupervisor(user!) ? `<a href="/supervisi/baru" class="${btnPrimary}">+ Buat Sesi Baru</a>` : ""}
       </div>
       ${msg ? alertBox(query.ok ? "ok" : "err", msg) : ""}
       ${
         sessions.length === 0
           ? `<p class="text-slate-500">Belum ada sesi supervisi.</p>`
           : `<div class="overflow-x-auto"><table class="w-full text-sm text-left">
               <thead><tr class="text-slate-500"><th class="pr-2 pb-1">Guru</th><th class="pr-2 pb-1">Kelas</th><th class="pr-2 pb-1">Tema / Mapel</th><th class="pr-2 pb-1">Observasi</th><th class="pr-2 pb-1">Status</th><th class="pb-1">Supervisor</th></tr></thead>
               <tbody>${rows}</tbody></table></div>`
       }`,
      "supervisi",
      "Sesi Supervisi",
    );
  })

  // ---------- Buat sesi ----------
  .get("/supervisi/baru", async ({ user, query }: any) => {
    if (!isSupervisor(user!)) {
      return new Response(null, { status: 302, headers: { Location: "/supervisi?err=" + encodeURIComponent("Hanya supervisor yang bisa membuat sesi.") } });
    }
    const pool = getPool();
    const school = await schoolName();
    const [tpls] = await pool.query<(RowDataPacket & { id: number; title: string; score_scale: number })[]>(
      "SELECT id, title, score_scale FROM templates WHERE status = 'aktif' ORDER BY title",
    );
    // Daftar guru yang boleh disupervisi — tanpa diri sendiri (supervisi diri sendiri dilarang).
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
      `<h1 class="text-2xl font-bold text-slate-900 mb-6">Buat Sesi Supervisi Baru</h1>
       ${msg ? alertBox(query.ok ? "ok" : "err", msg) : ""}
       ${
         tpls.length === 0
           ? `<p class="text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-4">Belum ada templat berstatus aktif. Minta admin mengaktifkan satu templat dulu.</p>`
           : teachers.length === 0
             ? `<p class="text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-4">Belum ada guru yang ditugaskan kepada Anda. ${user!.is_principal ? "" : "Minta admin mengatur penugasan Anda."}</p>`
             : `<form method="post" action="/supervisi/baru" class="space-y-4 max-w-lg">
          <div><label class="${labelCls}" for="template_id">Templat instrumen (aktif)</label>
            <select id="template_id" name="template_id" class="${inputCls}" required>
              ${tpls.map((t) => `<option value="${t.id}">${esc(t.title)} — skala ${t.score_scale}</option>`).join("")}
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
            <input id="subject_theme" name="subject_theme" class="${inputCls}" placeholder="mis. Descriptive Text — Bahasa Inggris" required></div>
          <div><label class="${labelCls}" for="phase_semester">Fase / semester</label>
            <input id="phase_semester" name="phase_semester" class="${inputCls}" placeholder="mis. Semester 1" required></div>
          <div class="grid grid-cols-2 gap-3">
            <div><label class="${labelCls}" for="observed_at">Tanggal observasi</label>
              <input id="observed_at" type="date" name="observed_at" value="${today}" class="${inputCls}" required></div>
            <div><label class="${labelCls}" for="observed_time">Waktu</label>
              <input id="observed_time" type="time" name="observed_time" class="${inputCls}"></div>
          </div>
          <button class="${btnPrimary}">Buat Sesi</button>
          <a href="/supervisi" class="${btnGhost}">Batal</a>
        </form>`
       }`,
      "supervisi",
      "Buat Sesi",
    );
  })
  .post("/supervisi/baru", async ({ user, body }: any) => {
    if (!isSupervisor(user!)) return redirErr("/supervisi", "Hanya supervisor yang bisa membuat sesi.");
    try {
      const id = await createSession(getPool(), user!, {
        templateId: Number(body?.template_id),
        teacherId: Number(body?.teacher_id),
        classId: Number(body?.class_id),
        subject_theme: String(body?.subject_theme ?? ""),
        phase_semester: String(body?.phase_semester ?? ""),
        observed_at: String(body?.observed_at ?? ""),
        observed_time: String(body?.observed_time ?? ""),
      });
      return redirOk(`/supervisi/${id}`, "Sesi dibuat. Isi instrumen tersalin dari templat.");
    } catch (err: any) {
      return redirErr("/supervisi/baru", err.message ?? "Gagal membuat sesi.");
    }
  })

  // ---------- Ringkasan sesi ----------
  .get("/supervisi/:id", async ({ user, params, query }: any) => {
    const s = await loadOr404(Number(params.id));
    if (!s) return new Response("Sesi tidak ditemukan.", { status: 404 });
    if (!canViewSession(user!, s)) return new Response("Anda tidak berhak melihat sesi ini.", { status: 403 });
    const pool = getPool();
    const school = await schoolName();
    const snap = await loadSnapshot(pool, s.id);
    const progress = await sessionProgress(pool, s.id);
    const evidence = await listEvidence(pool, s.id);
    const narrative = await getNarrativeForDisplay(pool, s.id);
    const msg = msgFromQuery(query as Record<string, string>);
    const flat = snap.elements.flatMap((el) => el.indicators);
    const overall = elementScores(flat);
    const final = finalScore100(flat, snap.scaleLevels);
    const predikat = predicateFor(final, snap.predicates);
    const owner = canEditSession(user!, s);
    const prog = (f: number, t: number) => `${f}/${t}`;
    return html(
      user!,
      school,
      `<div class="flex flex-wrap items-start justify-between gap-3 mb-2">
         <h1 class="text-2xl font-bold text-slate-900">Supervisi: ${esc(s.teacher_name)}</h1>
         <a href="/supervisi" class="${btnGhost}">← Semua Sesi</a>
       </div>
       <p class="text-slate-600 mb-4">${esc(s.class_name)} · ${esc(s.subject_theme ?? "")} · ${esc(s.phase_semester ?? "")} · ${esc(s.observed_at)}${s.observed_time ? ` ${esc(s.observed_time)}` : ""} · Periode ${esc(s.period_name)}</p>
       ${msg ? alertBox(query.ok ? "ok" : "err", msg) : ""}
       ${s.status === "pasca" && s.teacher_id === user!.id ? `<div class="mb-4 p-4 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 font-semibold">Menunggu refleksi Anda — silakan isi refleksi pasca-observasi di bawah.</div>` : ""}
       ${stageStepper(s)}
       <div class="grid md:grid-cols-2 gap-4 mb-4">
       ${card(
         "Identitas sesi",
         `<dl class="text-sm space-y-1">
            <div class="flex justify-between"><dt class="text-slate-500">Templat</dt><dd class="font-medium">${esc(s.template_title)}</dd></div>
            <div class="flex justify-between"><dt class="text-slate-500">Supervisor</dt><dd class="font-medium">${esc(s.supervisor_name)}</dd></div>
            <div class="flex justify-between"><dt class="text-slate-500">Guru</dt><dd class="font-medium">${esc(s.teacher_name)} (@${esc(s.teacher_username)})</dd></div>
            <div class="flex justify-between"><dt class="text-slate-500">Profil guru</dt><dd class="font-medium"><a class="text-teal-700 underline" href="/guru/${s.teacher_id}">Lihat profil & rekap →</a></dd></div>
            <div class="flex justify-between"><dt class="text-slate-500">Skala penilaian</dt><dd class="font-medium">${s.template_scale ?? "—"}</dd></div>
          </dl>`,
       )}
       ${card(
         "Progres pengisian",
         `<ul class="text-sm space-y-1">
            <li class="flex justify-between"><span>Pra-observasi</span><b>${prog(progress.pra.filled, progress.pra.total)}</b></li>
            <li class="flex justify-between"><span>Observasi (skor)</span><b>${prog(progress.observasi.filled, progress.observasi.total)}</b></li>
            <li class="flex justify-between"><span>Pasca (refleksi guru)</span><b>${prog(progress.pasca.filled, progress.pasca.total)}</b></li>
            <li class="flex justify-between"><span>Tindak lanjut</span><b>${prog(progress.tindak_lanjut.filled, progress.tindak_lanjut.total)}</b></li>
          </ul>
          <div class="mt-3 flex flex-wrap gap-2">
            <a href="/supervisi/${s.id}/pra" class="${btnGhost}">Pra</a>
            <a href="/supervisi/${s.id}/observasi" class="${btnGhost}">Observasi</a>
            <a href="/supervisi/${s.id}/pasca" class="${btnGhost}">Pasca</a>
            <a href="/supervisi/${s.id}/tindak-lanjut" class="${btnGhost}">Tindak Lanjut</a>
          </div>`,
       )}
       </div>
       ${card(
         "Skor sementara",
         final === null
           ? `<p class="text-sm text-slate-500">Belum ada indikator yang berskor.</p>`
           : `<p class="text-sm">Nilai akhir sementara: <b class="text-lg">${final.toFixed(1)}</b> / 100 — <b>${esc(predikat)}</b></p>
              <ul class="text-sm mt-2 space-y-1">
                ${overall.map((e) => `<li class="flex justify-between"><span>${esc(e.element_title)}</span><b>${e.average === null ? "—" : e.average.toFixed(2)}</b></li>`).join("")}
              </ul>
              <p class="text-xs text-slate-500 mt-2">Nilai sementara; berubah bila skor diubah sebelum sesi selesai.</p>`,
       )}
       ${narrative.edited || final !== null
         ? card(
             "Narasi",
             `<p class="text-sm whitespace-pre-wrap">${esc(narrative.text)}</p>
              <p class="text-xs text-slate-500 mt-2">${narrative.edited ? "Narasi ini sudah diedit supervisor." : "Narasi otomatis dari skor & catatan — belum diedit."}</p>
              ${canEditNarrative(user!, s) ? `<p class="mt-3"><a href="/supervisi/${s.id}/tindak-lanjut" class="${btnGhost}">Edit narasi →</a></p>` : ""}`,
           )
         : ""}
       ${evidence.length > 0
         ? card(
             "Bukti",
             `<div class="flex flex-wrap gap-3">${evidence
               .map((e) =>
                 e.kind === "foto"
                   ? `<a href="/bukti/${e.id}" target="_blank" rel="noopener"><img src="/bukti/${e.id}" alt="${esc(e.caption ?? "Foto bukti")}" class="w-28 h-28 object-cover rounded-lg border border-slate-200"></a>`
                   : `<a href="${esc(e.url ?? "")}" target="_blank" rel="noopener" class="text-sm text-indigo-700 underline break-all">🎬 ${esc(e.caption ?? e.url ?? "")}</a>`,
               )
               .join("")}</div>`,
           )
         : ""}
       <div class="mt-4">${owner ? statusButtons(s) : s.status === "selesai" ? `<p class="text-sm text-emerald-700 font-semibold">✓ Sesi ini sudah selesai dan terkunci.</p>` : ""}</div>
       <div class="mt-3"><a href="/supervisi/${s.id}/cetak" class="${btnPrimary}">🖨 Cetak Laporan</a></div>`,
      "supervisi",
      `Supervisi ${s.teacher_name}`,
    );
  })

  // ---------- Pindah status ----------
  .post("/supervisi/:id/status", async ({ user, params, body }: any) => {
    const target = String(body?.target ?? "") as SessionStatus;
    try {
      await setSessionStatus(getPool(), user!, Number(params.id), target);
      return redirOk(`/supervisi/${params.id}`, `Tahap berpindah ke ${STAGE_LABEL[target]}.`);
    } catch (err: any) {
      return redirErr(`/supervisi/${params.id}`, err.message ?? "Gagal memindah tahap.");
    }
  })

  // ---------- Pra-observasi ----------
  .get("/supervisi/:id/pra", async ({ user, params, query }: any) => {
    const s = await loadOr404(Number(params.id));
    if (!s) return new Response("Sesi tidak ditemukan.", { status: 404 });
    if (!canViewSession(user!, s)) return new Response("Anda tidak berhak melihat sesi ini.", { status: 403 });
    const pool = getPool();
    const school = await schoolName();
    const snap = await loadSnapshot(pool, s.id);
    const msg = msgFromQuery(query as Record<string, string>);
    const editable = canEditSession(user!, s) && s.status === "pra";
    return html(
      user!,
      school,
      `<h1 class="text-2xl font-bold text-slate-900 mb-1">Pra-Observasi — ${esc(s.teacher_name)}</h1>
       <p class="text-slate-600 mb-4">Diskusikan 5 pertanyaan ini dengan guru sebelum observasi. Boleh disimpan sebagian.</p>
       ${msg ? alertBox(query.ok ? "ok" : "err", msg) : ""}
       ${stageStepper(s)}
       ${!editable && s.status !== "selesai" ? `<p class="mb-4 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">Tahap ini ${s.status === "pra" ? "hanya bisa diisi supervisor pembuat sesi." : "sudah berlalu — gunakan tombol “Kembali ke Pra-Observasi” di ringkasan sesi untuk melengkapi isian."}</p>` : ""}
       <form method="post" action="/supervisi/${s.id}/pra" class="space-y-4 max-w-2xl">
         ${snap.praQuestions
           .map(
             (q, i) => `<div>
               <label class="${labelCls}" for="pra-${q.id}">${i + 1}. ${esc(q.text)}</label>
               <textarea id="pra-${q.id}" name="pra[${q.id}]" rows="3" class="${inputCls}" ${editable ? "" : "disabled"}>${esc(q.note)}</textarea>
             </div>`,
           )
           .join("")}
         ${editable ? `<div class="flex gap-2"><button class="${btnPrimary}">Simpan</button><button name="next" value="1" class="${btnPrimary}">Simpan & Lanjut ke Observasi →</button></div>` : ""}
       </form>
       <p class="mt-4"><a href="/supervisi/${s.id}" class="${btnGhost}">← Kembali ke Ringkasan</a></p>`,
      "supervisi",
      "Pra-Observasi",
    );
  })
  .post("/supervisi/:id/pra", async ({ user, params, body }: any) => {
    const id = Number(params.id);
    const s = await loadSession(getPool(), id);
    if (!s) return new Response("Sesi tidak ditemukan.", { status: 404 });
    if (s.status !== "pra") return redirErr(`/supervisi/${id}/pra`, "Tahap pra-observasi tidak sedang aktif.");
    try {
      await savePra(getPool(), user!, id, grouped(body, "pra"));
      if (body?.next) {
        await setSessionStatus(getPool(), user!, id, "observasi");
        return redirOk(`/supervisi/${id}/observasi`, "Pra-observasi disimpan. Lanjut ke observasi.");
      }
      return redirOk(`/supervisi/${id}/pra`, "Pra-observasi disimpan.");
    } catch (err: any) {
      return redirErr(`/supervisi/${id}/pra`, err.message ?? "Gagal menyimpan.");
    }
  })

  // ---------- Observasi ----------
  .get("/supervisi/:id/observasi", async ({ user, params, query }: any) => {
    const s = await loadOr404(Number(params.id));
    if (!s) return new Response("Sesi tidak ditemukan.", { status: 404 });
    if (!canViewSession(user!, s)) return new Response("Anda tidak berhak melihat sesi ini.", { status: 403 });
    const pool = getPool();
    const school = await schoolName();
    const snap = await loadSnapshot(pool, s.id);
    const evidence = await listEvidence(pool, s.id);
    const photoCount = evidence.filter((e) => e.kind === "foto").length;
    const msg = msgFromQuery(query as Record<string, string>);
    const editable = canEditSession(user!, s) && s.status === "observasi";
    const scoreBtn = (indId: number, level: { v: number; label: string }, current: number | null) => {
      const checked = current === level.v ? "checked" : "";
      return `<label class="cursor-pointer">
        <input type="radio" name="skor[${indId}]" value="${level.v}" class="peer sr-only" ${checked} ${editable ? "" : "disabled"}>
        <span class="inline-flex flex-col items-center min-w-14 px-3 py-3 rounded-xl border-2 border-slate-200 bg-white text-sm font-bold peer-checked:bg-indigo-600 peer-checked:text-white peer-checked:border-indigo-600">${level.v}<span class="text-[11px] font-normal leading-tight">${esc(level.label)}</span></span>
      </label>`;
    };
    return html(
      user!,
      school,
      `<h1 class="text-2xl font-bold text-slate-900 mb-1">Observasi — ${esc(s.teacher_name)}</h1>
       <p class="text-slate-600 mb-4">Ketuk skor tiap indikator (skala ${snap.scaleLevels.map((l) => l.v).join("–")}). Boleh disimpan sebagian.</p>
       ${msg ? alertBox(query.ok ? "ok" : "err", msg) : ""}
       ${stageStepper(s)}
       ${!editable && s.status !== "selesai" ? `<p class="mb-4 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">Tahap ini ${s.status === "observasi" ? "hanya bisa diisi supervisor pembuat sesi." : "sudah berlalu / belum tiba — pindah tahap dari ringkasan sesi untuk melengkapi isian."}</p>` : ""}
       <form method="post" action="/supervisi/${s.id}/observasi" class="space-y-6">
       ${snap.elements
         .map(
           (el) => `<section>
             <h2 class="text-lg font-bold text-slate-800 mb-3">${esc(el.code)} — ${esc(el.title)}</h2>
             ${el.indicators
               .map(
                 (ind) => `<div class="mb-4 p-4 rounded-xl border border-slate-200 bg-white">
                   <p class="font-medium text-slate-800 mb-3">${ind.sort}. ${esc(ind.text)}</p>
                   <div class="flex flex-wrap gap-2 mb-3">
                     ${snap.scaleLevels.map((l) => scoreBtn(ind.id, l, ind.value)).join("")}
                     <label class="cursor-pointer">
                       <input type="radio" name="skor[${ind.id}]" value="" class="peer sr-only" ${ind.value === null ? "checked" : ""} ${editable ? "" : "disabled"}>
                       <span class="inline-flex items-center px-3 py-3 rounded-xl border-2 border-dashed border-slate-300 text-sm text-slate-500 peer-checked:bg-slate-600 peer-checked:text-white peer-checked:border-slate-600">Belum dinilai</span>
                     </label>
                   </div>
                   <label class="${labelCls}" for="bukti-${ind.id}">Bukti / catatan (opsional)</label>
                   <textarea id="bukti-${ind.id}" name="bukti[${ind.id}]" rows="2" class="${inputCls}" ${editable ? "" : "disabled"}>${esc(ind.evidence)}</textarea>
                 </div>`,
               )
               .join("")}
           </section>`,
         )
         .join("")}
       ${editable ? `<div class="flex gap-2"><button class="${btnPrimary}">Simpan Skor</button><button name="next" value="1" class="${btnPrimary}">Simpan & Lanjut ke Pasca →</button></div>` : ""}
       </form>
       ${card(
         "Bukti foto & video",
         `<p class="text-sm text-slate-600 mb-3">Foto: ${photoCount}/${MAX_PHOTOS_PER_SESSION} · maks 5 MB per foto (dikompresi otomatis di perangkat Anda).</p>
          ${evidence.length > 0 ? `<div class="flex flex-wrap gap-3 mb-4">${evidence
            .map((e) =>
              e.kind === "foto"
                ? `<div class="relative"><a href="/bukti/${e.id}" target="_blank" rel="noopener"><img src="/bukti/${e.id}" alt="${esc(e.caption ?? "Foto bukti")}" class="w-24 h-24 object-cover rounded-lg border border-slate-200"></a>${e.caption ? `<p class="text-xs text-slate-500 mt-1 w-24">${esc(e.caption)}</p>` : ""}${editable ? `<form method="post" action="/supervisi/${s.id}/bukti/${e.id}/hapus" class="mt-1"><button class="text-xs text-red-600 underline">Hapus</button></form>` : ""}</div>`
                : `<div><a href="${esc(e.url ?? "")}" target="_blank" rel="noopener" class="text-sm text-indigo-700 underline break-all">🎬 ${esc(e.caption ?? e.url ?? "")}</a>${editable ? `<form method="post" action="/supervisi/${s.id}/bukti/${e.id}/hapus"><button class="text-xs text-red-600 underline">Hapus</button></form>` : ""}</div>`,
            )
            .join("")}</div>` : ""}
          ${editable && photoCount < MAX_PHOTOS_PER_SESSION ? `
          <form method="post" action="/supervisi/${s.id}/foto" enctype="multipart/form-data" class="space-y-3 mb-4">
            <div><label class="${labelCls}" for="foto">Unggah foto bukti (JPG/PNG/WebP)</label>
              <input id="foto" type="file" name="foto" accept="image/jpeg,image/png,image/webp" class="${inputCls}" required></div>
            <div><label class="${labelCls}" for="foto-caption">Keterangan foto (opsional, maks 200 karakter)</label>
              <input id="foto-caption" name="caption" maxlength="200" class="${inputCls}"></div>
            <p class="text-xs text-slate-500">Foto dikompresi di perangkat Anda sebelum diunggah (pola GezyAsko).</p>
            <button class="${btnPrimary}">Unggah Foto</button>
          </form>
          <script src="/static/js/kompres-foto.js"></script>` : ""}
          ${editable ? `
          <form method="post" action="/supervisi/${s.id}/video" class="space-y-3">
            <div><label class="${labelCls}" for="video-url">Tempel URL video (https)</label>
              <input id="video-url" type="url" name="url" placeholder="https://…" class="${inputCls}" required></div>
            <div><label class="${labelCls}" for="video-caption">Keterangan video (opsional)</label>
              <input id="video-caption" name="caption" maxlength="200" class="${inputCls}"></div>
            <button class="${btnPrimary}">Tambah Video</button>
          </form>` : ""}`,
       )}
       <p class="mt-4"><a href="/supervisi/${s.id}" class="${btnGhost}">← Kembali ke Ringkasan</a></p>`,
      "supervisi",
      "Observasi",
    );
  })
  .post("/supervisi/:id/observasi", async ({ user, params, body }: any) => {
    const id = Number(params.id);
    const s = await loadSession(getPool(), id);
    if (!s) return new Response("Sesi tidak ditemukan.", { status: 404 });
    if (s.status !== "observasi") return redirErr(`/supervisi/${id}/observasi`, "Tahap observasi tidak sedang aktif.");
    try {
      const skor = grouped(body, "skor");
      const bukti = grouped(body, "bukti");
      const snap = await loadSnapshot(getPool(), id);
      const ids = snap.elements.flatMap((el) => el.indicators.map((i) => i.id));
      const entries = ids.map((indId) => ({
        indicatorId: indId,
        value: skor[indId] === undefined || skor[indId] === "" ? null : Number(skor[indId]),
        evidence: bukti[indId] ?? "",
      }));
      await saveScores(getPool(), user!, id, entries);
      if (body?.next) {
        await setSessionStatus(getPool(), user!, id, "pasca");
        return redirOk(`/supervisi/${id}/pasca`, "Skor disimpan. Lanjut ke pasca-observasi — guru dapat mengisi refleksi.");
      }
      return redirOk(`/supervisi/${id}/observasi`, "Skor disimpan.");
    } catch (err: any) {
      return redirErr(`/supervisi/${id}/observasi`, err.message ?? "Gagal menyimpan skor.");
    }
  })
  .post("/supervisi/:id/foto", async ({ user, params, body }: any) => {
    const id = Number(params.id);
    const s = await loadSession(getPool(), id);
    if (!s) return new Response("Sesi tidak ditemukan.", { status: 404 });
    if (!canEditSession(user!, s)) return redirErr(`/supervisi/${id}/observasi`, "Hanya supervisor pembuat sesi yang bisa mengunggah foto.");
    const file = body?.foto;
    if (!file || typeof file !== "object" || typeof file.arrayBuffer !== "function") {
      return redirErr(`/supervisi/${id}/observasi`, "Tidak ada berkas foto yang diterima.");
    }
    const err = validatePhoto({ size: file.size, type: file.type });
    if (err) return redirErr(`/supervisi/${id}/observasi`, err);
    if ((await countPhotos(getPool(), id)) >= MAX_PHOTOS_PER_SESSION) {
      return redirErr(`/supervisi/${id}/observasi`, `Maksimal ${MAX_PHOTOS_PER_SESSION} foto per sesi.`);
    }
    try {
      const buf = Buffer.from(await file.arrayBuffer());
      await storePhoto(getPool(), id, buf, file.type, String(body?.caption ?? ""));
      return redirOk(`/supervisi/${id}/observasi`, "Foto bukti diunggah.");
    } catch (e: any) {
      return redirErr(`/supervisi/${id}/observasi`, e.message ?? "Gagal mengunggah foto.");
    }
  })
  .post("/supervisi/:id/video", async ({ user, params, body }: any) => {
    const id = Number(params.id);
    const s = await loadSession(getPool(), id);
    if (!s) return new Response("Sesi tidak ditemukan.", { status: 404 });
    if (!canEditSession(user!, s)) return redirErr(`/supervisi/${id}/observasi`, "Hanya supervisor pembuat sesi yang bisa menambah video.");
    const url = String(body?.url ?? "");
    const err = validateVideoUrl(url);
    if (err) return redirErr(`/supervisi/${id}/observasi`, err);
    try {
      await addVideoUrl(getPool(), id, url, String(body?.caption ?? ""));
      return redirOk(`/supervisi/${id}/observasi`, "URL video ditambahkan.");
    } catch (e: any) {
      return redirErr(`/supervisi/${id}/observasi`, e.message ?? "Gagal menambah video.");
    }
  })
  .post("/supervisi/:id/bukti/:eid/hapus", async ({ user, params }: any) => {
    const id = Number(params.id);
    const s = await loadSession(getPool(), id);
    if (!s) return new Response("Sesi tidak ditemukan.", { status: 404 });
    if (!canEditSession(user!, s)) return redirErr(`/supervisi/${id}/observasi`, "Hanya supervisor pembuat sesi yang bisa menghapus bukti.");
    try {
      await deleteEvidence(getPool(), Number(params.eid));
      return redirOk(`/supervisi/${id}/observasi`, "Bukti dihapus.");
    } catch (e: any) {
      return redirErr(`/supervisi/${id}/observasi`, e.message ?? "Gagal menghapus bukti.");
    }
  })

  // ---------- Pasca-observasi ----------
  .get("/supervisi/:id/pasca", async ({ user, params, query }: any) => {
    const s = await loadOr404(Number(params.id));
    if (!s) return new Response("Sesi tidak ditemukan.", { status: 404 });
    if (!canViewSession(user!, s)) return new Response("Anda tidak berhak melihat sesi ini.", { status: 403 });
    const pool = getPool();
    const school = await schoolName();
    const snap = await loadSnapshot(pool, s.id);
    const msg = msgFromQuery(query as Record<string, string>);
    const isGuru = s.teacher_id === user!.id;
    const guruEditable = isGuru && s.status === "pasca";
    const supEditable = canEditSession(user!, s) && s.status === "pasca";
    return html(
      user!,
      school,
      `<h1 class="text-2xl font-bold text-slate-900 mb-1">Pasca-Observasi — ${esc(s.teacher_name)}</h1>
       <p class="text-slate-600 mb-4">Guru mengisi refleksi sendiri; supervisor membaca lalu menambah catatan. Refleksi hanya bisa diisi saat tahap pasca-observasi aktif.</p>
       ${msg ? alertBox(query.ok ? "ok" : "err", msg) : ""}
       ${stageStepper(s)}
       ${s.status !== "pasca" && s.status !== "selesai" ? `<p class="mb-4 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">Tahap pasca-observasi belum aktif (status saat ini: ${STAGE_LABEL[s.status]}).</p>` : ""}
       <div class="space-y-6 max-w-2xl">
       ${snap.pascaQuestions
         .map(
           (q, i) => `<section class="p-4 rounded-xl border border-slate-200 bg-white">
             <h2 class="font-bold text-slate-800 mb-3">${i + 1}. ${esc(q.text)}</h2>
             <form method="post" action="/supervisi/${s.id}/pasca" class="space-y-3">
               <input type="hidden" name="field" value="guru">
               <div><label class="${labelCls}" for="guru-${q.id}">Refleksi guru</label>
                 <textarea id="guru-${q.id}" name="guru[${q.id}]" rows="3" class="${inputCls}" ${guruEditable ? "" : "disabled"}>${esc(q.guru_note)}</textarea></div>
               ${guruEditable ? `<button class="${btnPrimary}">Simpan Refleksi Ini</button>` : ""}
             </form>
             <form method="post" action="/supervisi/${s.id}/pasca" class="space-y-3 mt-3">
               <input type="hidden" name="field" value="supervisor">
               <div><label class="${labelCls}" for="sup-${q.id}">Catatan supervisor</label>
                 <textarea id="sup-${q.id}" name="sup[${q.id}]" rows="3" class="${inputCls}" ${supEditable ? "" : "disabled"}>${esc(q.supervisor_note)}</textarea></div>
               ${supEditable ? `<button class="${btnPrimary}">Simpan Catatan Ini</button>` : ""}
             </form>
           </section>`,
         )
         .join("")}
       </div>
       <p class="mt-4"><a href="/supervisi/${s.id}" class="${btnGhost}">← Kembali ke Ringkasan</a></p>`,
      "supervisi",
      "Pasca-Observasi",
    );
  })
  .post("/supervisi/:id/pasca", async ({ user, params, body }: any) => {
    const id = Number(params.id);
    const s = await loadSession(getPool(), id);
    if (!s) return new Response("Sesi tidak ditemukan.", { status: 404 });
    try {
      if (body?.field === "guru") {
        await savePascaGuru(getPool(), user!, id, grouped(body, "guru"));
        return redirOk(`/supervisi/${id}/pasca`, "Refleksi disimpan.");
      }
      if (body?.field === "supervisor") {
        if (s.status !== "pasca") return redirErr(`/supervisi/${id}/pasca`, "Tahap pasca-observasi tidak sedang aktif.");
        await savePascaSupervisor(getPool(), user!, id, grouped(body, "sup"));
        return redirOk(`/supervisi/${id}/pasca`, "Catatan supervisor disimpan.");
      }
      return redirErr(`/supervisi/${id}/pasca`, "Form tidak dikenal.");
    } catch (err: any) {
      return redirErr(`/supervisi/${id}/pasca`, err.message ?? "Gagal menyimpan.");
    }
  })

  // ---------- Tindak lanjut ----------
  .get("/supervisi/:id/tindak-lanjut", async ({ user, params, query }: any) => {
    const s = await loadOr404(Number(params.id));
    if (!s) return new Response("Sesi tidak ditemukan.", { status: 404 });
    if (!canViewSession(user!, s)) return new Response("Anda tidak berhak melihat sesi ini.", { status: 403 });
    const pool = getPool();
    const school = await schoolName();
    const snap = await loadSnapshot(pool, s.id);
    const msg = msgFromQuery(query as Record<string, string>);
    const editable = canEditSession(user!, s) && s.status === "tindak_lanjut";
    const narrative = await getNarrativeForDisplay(pool, s.id);
    const canEditNar =
      canEditNarrative(user!, s) && (s.status === "tindak_lanjut" || s.status === "selesai");
    return html(
      user!,
      school,
      `<h1 class="text-2xl font-bold text-slate-900 mb-1">Tindak Lanjut — ${esc(s.teacher_name)}</h1>
       <p class="text-slate-600 mb-4">Isi rencana tindak lanjut dari 3 butir di bawah, lalu periksa dan edit narasi hasil observasi.</p>
       ${msg ? alertBox(query.ok ? "ok" : "err", msg) : ""}
       ${stageStepper(s)}
       ${!editable && s.status !== "selesai" ? `<p class="mb-4 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">Tahap ini ${s.status === "tindak_lanjut" ? "hanya bisa diisi supervisor pembuat sesi." : "sudah berlalu / belum tiba — pindah tahap dari ringkasan sesi untuk melengkapi isian."}</p>` : ""}
       ${card(
         "Narasi",
         `<p class="text-sm whitespace-pre-wrap">${esc(narrative.text)}</p>
          <p class="text-xs text-slate-500 mt-2">${narrative.edited ? "Narasi ini sudah diedit supervisor — regenerasi otomatis tidak akan menimpanya." : "Narasi otomatis dari skor & catatan — belum diedit."}</p>`,
       )}
       ${canEditNar
         ? `<form method="post" action="/supervisi/${s.id}/narasi" class="space-y-3 max-w-2xl mt-4">
              <div>
                <label class="${labelCls}" for="narasi">Edit narasi</label>
                <textarea id="narasi" name="narasi" rows="8" class="${inputCls}">${esc(narrative.text)}</textarea>
              </div>
              <div class="flex flex-wrap gap-2">
                <button class="${btnPrimary}">Simpan narasi</button>
              </div>
            </form>
            <form method="post" action="/supervisi/${s.id}/narasi/buat-ulang" class="max-w-2xl mt-2">
              <button class="${btnGhost}" onclick="return confirm('Buat ulang narasi dari data sesi saat ini? Narasi hasil edit akan ditimpa.')">↻ Buat ulang narasi</button>
            </form>`
         : `<p class="text-sm text-slate-500 mt-4">${s.status === "selesai" ? "Narasi hanya bisa diedit supervisor pembuat sesi." : "Narasi bisa diedit supervisor pembuat sesi pada tahap tindak lanjut."}</p>`}
       <form method="post" action="/supervisi/${s.id}/tindak-lanjut" class="space-y-4 max-w-2xl mt-4">
         ${snap.rtlItems
           .map(
             (r, i) => `<div>
               <label class="${labelCls}" for="rtl-${r.id}">${i + 1}. ${esc(r.title)}</label>
               <textarea id="rtl-${r.id}" name="rtl[${r.id}]" rows="3" class="${inputCls}" ${editable ? "" : "disabled"}>${esc(r.note)}</textarea>
             </div>`,
           )
           .join("")}
         ${editable ? `<div class="flex gap-2"><button class="${btnPrimary}">Simpan</button><button name="next" value="1" class="${btnPrimary}">Simpan & Tandai Selesai →</button></div>` : ""}
       </form>
       <p class="mt-4"><a href="/supervisi/${s.id}" class="${btnGhost}">← Kembali ke Ringkasan</a></p>`,
      "supervisi",
      "Tindak Lanjut",
    );
  })
  .post("/supervisi/:id/tindak-lanjut", async ({ user, params, body }: any) => {
    const id = Number(params.id);
    const s = await loadSession(getPool(), id);
    if (!s) return new Response("Sesi tidak ditemukan.", { status: 404 });
    if (s.status !== "tindak_lanjut") return redirErr(`/supervisi/${id}/tindak-lanjut`, "Tahap tindak lanjut tidak sedang aktif.");
    try {
      await saveRtl(getPool(), user!, id, grouped(body, "rtl"));
      if (body?.next) {
        await setSessionStatus(getPool(), user!, id, "selesai");
        return redirOk(`/supervisi/${id}`, "Tindak lanjut disimpan. Sesi selesai dan terkunci.");
      }
      return redirOk(`/supervisi/${id}/tindak-lanjut`, "Tindak lanjut disimpan.");
    } catch (err: any) {
      return redirErr(`/supervisi/${id}/tindak-lanjut`, err.message ?? "Gagal menyimpan.");
    }
  })

  // ---------- Narasi (Fase 3) ----------
  .post("/supervisi/:id/narasi", async ({ user, params, body }: any) => {
    const id = Number(params.id);
    const back = body?.redirect === "cetak" ? `/supervisi/${id}/cetak` : `/supervisi/${id}/tindak-lanjut`;
    try {
      await saveNarrative(getPool(), user!, id, String(body?.narasi ?? ""));
      return redirOk(back, "Narasi disimpan.");
    } catch (err: any) {
      return redirErr(back, err.message ?? "Gagal menyimpan narasi.");
    }
  })
  .post("/supervisi/:id/narasi/buat-ulang", async ({ user, params, body }: any) => {
    const id = Number(params.id);
    const back = body?.redirect === "cetak" ? `/supervisi/${id}/cetak` : `/supervisi/${id}/tindak-lanjut`;
    try {
      await regenerateNarrative(getPool(), user!, id);
      return redirOk(back, "Narasi dibuat ulang dari data sesi saat ini.");
    } catch (err: any) {
      return redirErr(back, err.message ?? "Gagal membuat ulang narasi.");
    }
  })

  // ---------- Layani foto bukti (bukan statis publik) ----------
  .get("/bukti/:id", async ({ user, params }: any) => {
    const ev = await getEvidence(getPool(), Number(params.id));
    if (!ev || ev.kind !== "foto" || !ev.path) return new Response("Bukti tidak ditemukan.", { status: 404 });
    const s = await loadSession(getPool(), ev.session_id);
    if (!s) return new Response("Bukti tidak ditemukan.", { status: 404 });
    if (!canViewSession(user!, s)) return new Response("Anda tidak berhak melihat bukti ini.", { status: 403 });
    const fullPath = path.join(evidenceDir(), path.basename(ev.path));
    try {
      const data = await readFile(fullPath);
      return new Response(data, {
        headers: {
          "Content-Type": ev.mime ?? "application/octet-stream",
          "Cache-Control": "private, max-age=3600",
        },
      });
    } catch {
      return new Response("Berkas bukti tidak ditemukan di server.", { status: 404 });
    }
  });
