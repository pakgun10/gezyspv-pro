import { Elysia } from "elysia";
import { getPool } from "../db";
import { authPlugin, requireAdmin, requireAuth } from "./auth";
import { isSupervisor } from "../rbac";
import {
  addElement,
  addIndicator,
  addPredicate,
  addPrinciple,
  addQuestion,
  addRtlItem,
  addScaleLevel,
  copyTemplate,
  createTemplate,
  deleteElement,
  deleteIndicator,
  deletePredicate,
  deletePrinciple,
  deleteQuestion,
  deleteRtlItem,
  deleteScaleLevel,
  deleteTemplate,
  listTemplates,
  loadTemplateDetail,
  setTemplateStatus,
  updateElement,
  updateIndicator,
  updatePredicate,
  updatePrinciple,
  updateQuestion,
  updateRtlItem,
  updateScaleLevel,
  updateTemplateMeta,
  type ScoreScale,
  type TemplateRow,
  type TemplateStatus,
} from "../lib/templates";
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

/**
 * Route templat — Fase 1 (plan bagian 4 matriks peran, bagian 7).
 *
 * Dua instance:
 * - templateAdminRoutes (guard requireAdmin): kelola templat penuh.
 * - templatePredicateRoutes (guard admin ATAU supervisor): daftar
 *   templat (baca saja) + ubah rentang predikat. Guru 403 di semua
 *   route templat.
 */

function html(
  user: NonNullable<Parameters<typeof layout>[0]["user"]>,
  schoolName: string,
  body: string,
  active: string,
): Response {
  return new Response(layout({ title: "Templat", user, schoolName, body, active }), {
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

const STATUS_BADGE: Record<TemplateStatus, string> = {
  draf: '<span class="px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 text-xs font-semibold">Draf</span>',
  aktif: '<span class="px-2 py-0.5 rounded-full bg-teal-50 text-teal-700 text-xs font-semibold">Aktif</span>',
  arsip: '<span class="px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 text-xs font-semibold">Arsip</span>',
};

function statusActions(t: TemplateRow): string {
  const buttons: string[] = [];
  const btn = (target: TemplateStatus, label: string, cls: string) =>
    `<form method="post" action="/admin/templat/${t.id}/status" class="inline">
      <input type="hidden" name="status" value="${target}">
      <button type="submit" class="${cls}">${label}</button>
    </form>`;
  if (t.status === "draf") {
    buttons.push(btn("aktif", "Aktifkan", btnPrimary));
    buttons.push(btn("arsip", "Arsipkan", btnGhost));
  } else if (t.status === "aktif") {
    buttons.push(btn("arsip", "Arsipkan", btnGhost));
  } else {
    buttons.push(btn("draf", "Kembalikan ke draf", btnGhost));
  }
  buttons.push(
    `<form method="post" action="/admin/templat/${t.id}/salin" class="inline">
      <button type="submit" class="${btnGhost}">Salin untuk tahun ajaran baru</button>
    </form>`,
  );
  return buttons.join(" ");
}

// ---------- Instance admin ----------

export const templateAdminRoutes = new Elysia().use(authPlugin).onBeforeHandle(requireAdmin)
  // ---------- Daftar + buat ----------
  .get("/admin/templat", async ({ user, query }: any) => {
    const templates = await listTemplates(getPool());
    const msg = msgFromQuery(query as Record<string, string>);
    return html(
      user!,
      await schoolName(),
      `
<h1 class="text-2xl font-bold text-slate-900 mb-6">Templat Instrumen</h1>
${msg ? alertBox(query.ok ? "ok" : "err", msg) : ""}
<p class="text-sm text-slate-600 mb-4">Instrumen supervisi adalah templat yang bisa diubah tiap tahun. Templat <strong>draf</strong> bisa diedit tapi belum bisa dipakai sesi baru; <strong>aktif</strong> bisa dipakai sesi baru; <strong>arsip</strong> tidak bisa diedit maupun dipakai sesi baru (menyalinnya tetap bisa). Templat yang sudah pernah dipakai sesi tidak bisa dihapus — hanya bisa diarsipkan.</p>
<div class="grid lg:grid-cols-5 gap-4 items-start">
<div class="lg:col-span-3">
${card(
  "Daftar templat",
  templates.length === 0
    ? `<p class="text-sm text-slate-500">Belum ada templat.</p>`
    : `<div class="overflow-x-auto"><table class="w-full text-sm">
      <thead><tr class="text-left text-slate-500 border-b">
        <th class="py-2 pr-2">Templat</th><th class="py-2 pr-2">Skala</th><th class="py-2 pr-2">Status</th>
        <th class="py-2 pr-2">Isi</th><th class="py-2 pr-2">Dipakai</th><th class="py-2"></th></tr></thead>
      <tbody>${templates
        .map(
          (t) => `<tr class="border-b border-slate-100">
          <td class="py-2 pr-2 font-medium">${esc(t.title)}${t.is_seed ? ' <span class="text-xs text-teal-700 font-semibold">· Bawaan</span>' : ""}<br>
            <span class="text-xs text-slate-400">${esc(t.version_label)}${t.basis ? ` · ${esc(t.basis)}` : ""}</span></td>
          <td class="py-2 pr-2">${t.score_scale}</td>
          <td class="py-2 pr-2">${STATUS_BADGE[t.status]}</td>
          <td class="py-2 pr-2">${t.elements} elemen · ${t.indicators} indikator</td>
          <td class="py-2 pr-2">${t.usedBySessions} sesi</td>
          <td class="py-2 text-right whitespace-nowrap">
            <a class="${btnGhost}" href="/admin/templat/${t.id}">Kelola</a>
            ${statusActions(t)}
          </td>
        </tr>`,
        )
        .join("")}</tbody></table></div>`,
)}
</div>
<div class="lg:col-span-2">
${card(
  "Buat templat baru",
  `<form method="post" action="/admin/templat" class="space-y-3">
    <div><label class="${labelCls}">Judul templat</label><input class="${inputCls}" name="title" required placeholder="mis. Supervisi Akademik PPB/GM 2027/2028"></div>
    <div><label class="${labelCls}">Basis / pendekatan (opsional)</label><input class="${inputCls}" name="basis" placeholder="mis. Pola Pikir Bertumbuh / Growth Mindset"></div>
    <div><label class="${labelCls}">Label tahun/versi (opsional)</label><input class="${inputCls}" name="version_label" placeholder="mis. 2027/2028"></div>
    <div><label class="${labelCls}">Skala penilaian indikator</label>
      <select class="${inputCls}" name="score_scale">
        <option value="2">Skala 2 (0/1/2)</option>
        <option value="4">Skala 4</option>
        <option value="10">Skala 10</option>
        <option value="100">Skala 100</option>
      </select></div>
    <button type="submit" class="${btnPrimary}">Buat Templat (Draf)</button>
    <p class="text-xs text-slate-400">Templat baru selalu berstatus draf. Isi (prinsip, elemen, indikator, pertanyaan, skala, predikat) ditambahkan di halaman Kelola, lalu aktifkan bila sudah siap dipakai.</p>
  </form>`,
)}
</div>
</div>`,
      "templat",
    );
  })
  .post("/admin/templat", async ({ body }: any) => {
    const b = body as Record<string, string>;
    const scale = num(b.score_scale);
    try {
      const id = await createTemplate(getPool(), {
        title: b.title ?? "",
        basis: b.basis ?? "",
        version_label: b.version_label ?? "",
        score_scale: (scale === 2 || scale === 10 || scale === 100 ? scale : 4) as ScoreScale,
      });
      return redirOk(`/admin/templat/${id}`, "Templat dibuat (status draf). Silakan lengkapi isinya.");
    } catch (err) {
      return redirErr("/admin/templat", err instanceof Error ? err.message : "Gagal membuat templat.");
    }
  })

  // ---------- Halaman kelola (edit) ----------
  .get("/admin/templat/:id", async ({ user, params, query }: any) => {
    const pool = getPool();
    const id = Number(params.id);
    let detail;
    try {
      detail = await loadTemplateDetail(pool, id);
    } catch {
      return new Response("Templat tidak ditemukan.", { status: 404 });
    }
    const t = detail.template;
    const editable = t.status !== "arsip";
    const msg = msgFromQuery(query as Record<string, string>);
    const input = (name: string, value: string, extra = "") =>
      `<input class="${inputCls}" name="${name}" value="${esc(value)}" ${extra}>`;

    const principleRows = detail.principles
      .map(
        (p, i) => `<li class="py-2 border-b border-slate-100 last:border-0">
        ${editable
          ? `<form method="post" action="/admin/templat/prinsip/${p.id}" class="flex flex-col sm:flex-row gap-2">
              <input type="hidden" name="template_id" value="${t.id}">
              <span class="text-sm font-semibold text-slate-400 w-6 pt-2.5">${i + 1}.</span>
              <textarea class="${inputCls} flex-1" name="text" rows="2" required>${esc(p.text)}</textarea>
              <span class="flex gap-2"><button type="submit" class="${btnGhost}">Simpan</button>
              <button type="submit" formaction="/admin/templat/prinsip/${p.id}/hapus" formmethod="post" class="${btnDanger}" onclick="return confirm('Hapus prinsip ini?')">Hapus</button></span>
            </form>`
          : `<span class="text-sm"><span class="font-semibold text-slate-400">${i + 1}.</span> ${esc(p.text)}</span>`}
      </li>`,
      )
      .join("");

    const elementSections = detail.elements
      .map(
        (el) => `
<div class="border border-slate-200 rounded-xl p-4 mb-3">
  ${editable
    ? `<form method="post" action="/admin/templat/elemen/${el.id}" class="flex flex-col sm:flex-row gap-2 mb-3">
        <input type="hidden" name="template_id" value="${t.id}">
        <input class="${inputCls} sm:w-20" name="code" value="${esc(el.code)}" required title="Kode elemen">
        <input class="${inputCls} flex-1" name="title" value="${esc(el.title)}" required title="Judul elemen">
        <span class="flex gap-2"><button type="submit" class="${btnGhost}">Simpan</button>
        <button type="submit" formaction="/admin/templat/elemen/${el.id}/hapus" formmethod="post" class="${btnDanger}" onclick="return confirm('Hapus elemen ${esc(el.code)} beserta seluruh indikatornya?')">Hapus</button></span>
      </form>`
    : `<p class="font-semibold text-sm mb-2">${esc(el.code)}. ${esc(el.title)}</p>`}
  <ol class="space-y-2">
    ${el.indicators
      .map(
        (ind, i) => `<li>
        ${editable
          ? `<form method="post" action="/admin/templat/indikator/${ind.id}" class="flex flex-col sm:flex-row gap-2">
              <input type="hidden" name="template_id" value="${t.id}">
              <span class="text-sm font-semibold text-slate-400 w-8 pt-2.5">${el.code}.${i + 1}</span>
              <textarea class="${inputCls} flex-1" name="text" rows="2" required>${esc(ind.text)}</textarea>
              <span class="flex gap-2"><button type="submit" class="${btnGhost}">Simpan</button>
              <button type="submit" formaction="/admin/templat/indikator/${ind.id}/hapus" formmethod="post" class="${btnDanger}" onclick="return confirm('Hapus indikator ini?')">Hapus</button></span>
            </form>`
          : `<span class="text-sm"><span class="font-semibold text-slate-400">${el.code}.${i + 1}</span> ${esc(ind.text)}</span>`}
      </li>`,
      )
      .join("")}
  </ol>
  ${editable
    ? `<form method="post" action="/admin/templat/${t.id}/indikator" class="flex flex-col sm:flex-row gap-2 mt-3">
        <input type="hidden" name="element_id" value="${el.id}">
        <input class="${inputCls} flex-1" name="text" required placeholder="Tambah indikator baru di elemen ${esc(el.code)}…">
        <button type="submit" class="${btnPrimary}">+ Indikator</button>
      </form>`
    : ""}
</div>`,
      )
      .join("");

    const questionList = (stage: "pra" | "pasca", list: { id: number; text: string }[]) =>
      list
        .map(
          (q, i) => `<li class="py-2 border-b border-slate-100 last:border-0">
        ${editable
          ? `<form method="post" action="/admin/templat/pertanyaan/${q.id}" class="flex flex-col sm:flex-row gap-2">
              <input type="hidden" name="template_id" value="${t.id}">
              <span class="text-sm font-semibold text-slate-400 w-6 pt-2.5">${i + 1}.</span>
              <textarea class="${inputCls} flex-1" name="text" rows="2" required>${esc(q.text)}</textarea>
              <span class="flex gap-2"><button type="submit" class="${btnGhost}">Simpan</button>
              <button type="submit" formaction="/admin/templat/pertanyaan/${q.id}/hapus" formmethod="post" class="${btnDanger}" onclick="return confirm('Hapus pertanyaan ini?')">Hapus</button></span>
            </form>`
          : `<span class="text-sm"><span class="font-semibold text-slate-400">${i + 1}.</span> ${esc(q.text)}</span>`}
      </li>`,
        )
        .join("") +
      (editable
        ? `<li class="pt-3"><form method="post" action="/admin/templat/${t.id}/pertanyaan" class="flex flex-col sm:flex-row gap-2">
            <input type="hidden" name="stage" value="${stage}">
            <textarea class="${inputCls} flex-1" name="text" rows="2" required placeholder="Tambah pertanyaan ${stage === "pra" ? "pra-observasi" : "pasca-observasi"} baru…"></textarea>
            <button type="submit" class="${btnPrimary}">+ Pertanyaan</button>
          </form></li>`
        : "");

    const rtlRows = detail.rtlItems
      .map(
        (r, i) => `<li class="py-2 border-b border-slate-100 last:border-0">
        ${editable
          ? `<form method="post" action="/admin/templat/rtl/${r.id}" class="flex flex-col sm:flex-row gap-2">
              <input type="hidden" name="template_id" value="${t.id}">
              <span class="text-sm font-semibold text-slate-400 w-6 pt-2.5">${i + 1}.</span>
              <input class="${inputCls} flex-1" name="title" value="${esc(r.title)}" required>
              <span class="flex gap-2"><button type="submit" class="${btnGhost}">Simpan</button>
              <button type="submit" formaction="/admin/templat/rtl/${r.id}/hapus" formmethod="post" class="${btnDanger}" onclick="return confirm('Hapus butir tindak lanjut ini?')">Hapus</button></span>
            </form>`
          : `<span class="text-sm"><span class="font-semibold text-slate-400">${i + 1}.</span> ${esc(r.title)}</span>`}
      </li>`,
      )
      .join("");

    const scaleRows = detail.scaleLevels
      .map(
        (lv) => `<li class="py-2 border-b border-slate-100 last:border-0">
        ${editable
          ? `<form method="post" action="/admin/templat/skala/${lv.id}" class="flex flex-col sm:flex-row gap-2 items-start sm:items-center">
              <input type="hidden" name="template_id" value="${t.id}">
              <input class="${inputCls} sm:w-24" name="v" type="number" value="${lv.v}" required title="Nilai skala">
              <input class="${inputCls} flex-1" name="label" value="${esc(lv.label)}" required>
              <span class="flex gap-2"><button type="submit" class="${btnGhost}">Simpan</button>
              <button type="submit" formaction="/admin/templat/skala/${lv.id}/hapus" formmethod="post" class="${btnDanger}" onclick="return confirm('Hapus label skala ${lv.v}?')">Hapus</button></span>
            </form>`
          : `<span class="text-sm"><span class="font-semibold">${lv.v}</span> — ${esc(lv.label)}</span>`}
      </li>`,
      )
      .join("");

    const predicateRows =
      detail.predicates.length === 0
        ? `<p class="text-sm text-slate-500">Belum ada rentang predikat. Nilai akhir yang jatuh di luar rentang akan tampil tanpa predikat ("—").</p>`
        : `<div class="overflow-x-auto"><table class="w-full text-sm">
          <thead><tr class="text-left text-slate-500 border-b"><th class="py-2 pr-2">Rentang (skala 100)</th><th class="py-2 pr-2">Predikat</th></tr></thead>
          <tbody>${detail.predicates
            .map(
              (p) => `<tr class="border-b border-slate-100"><td class="py-2 pr-2 font-medium">${p.min}–${p.max}</td><td class="py-2 pr-2">${esc(p.label)}</td></tr>`,
            )
            .join("")}</tbody></table></div>`;

    return html(
      user!,
      await schoolName(),
      `
<p class="mb-4"><a class="text-teal-700 font-semibold underline text-sm" href="/admin/templat">← Daftar templat</a></p>
<h1 class="text-2xl font-bold text-slate-900 mb-1">${esc(t.title)}</h1>
<p class="text-sm text-slate-500 mb-4">${STATUS_BADGE[t.status]} <span class="ml-2">Skala ${t.score_scale}</span>${t.version_label ? ` <span class="ml-2">· ${esc(t.version_label)}</span>` : ""}${t.is_seed ? ` <span class="ml-2 text-teal-700 font-semibold">· Templat bawaan</span>` : ""} <span class="ml-2">· Dipakai ${detail.usedBySessions} sesi</span></p>
${msg ? alertBox(query.ok ? "ok" : "err", msg) : ""}
${!editable ? alertBox("info", "Templat arsip tidak bisa diubah. Salin dulu templat ini bila perlu versi yang bisa diedit.") : ""}
<div class="flex flex-wrap gap-2 mb-6">${statusActions(t)}
  ${t.is_seed || detail.usedBySessions > 0
    ? `<span class="text-xs text-slate-400 self-center">${t.is_seed ? "Templat bawaan tidak boleh dihapus." : "Templat sudah dipakai sesi — tidak bisa dihapus, hanya bisa diarsipkan."}</span>`
    : `<form method="post" action="/admin/templat/${t.id}/hapus" class="inline" onsubmit="return confirm('Hapus templat ${esc(t.title)}? Tindakan ini tidak bisa dibatalkan.')">
        <button type="submit" class="${btnDanger}">Hapus Templat</button>
      </form>`}
</div>
<div class="space-y-4">
${card(
  "Identitas templat",
  editable
    ? `<form method="post" action="/admin/templat/${t.id}" class="space-y-3 max-w-2xl">
        <div><label class="${labelCls}">Judul templat</label>${input("title", t.title, "required")}</div>
        <div><label class="${labelCls}">Basis / pendekatan</label>${input("basis", t.basis ?? "")}</div>
        <div><label class="${labelCls}">Label tahun/versi</label>${input("version_label", t.version_label ?? "")}</div>
        <div><label class="${labelCls}">Skala penilaian indikator</label>
          <select class="${inputCls}" name="score_scale">
            ${[2, 4, 10, 100].map((s) => `<option value="${s}" ${t.score_scale === s ? "selected" : ""}>Skala ${s}</option>`).join("")}
          </select>
          <p class="text-xs text-slate-400 mt-1">Mengubah skala ditolak bila ada label skala yang nilainya di luar rentang skala baru.</p></div>
        <button type="submit" class="${btnPrimary}">Simpan Identitas</button>
      </form>`
    : `<dl class="text-sm space-y-1">
        <div><dt class="text-slate-500">Judul</dt><dd class="font-medium">${esc(t.title)}</dd></div>
        <div><dt class="text-slate-500">Basis</dt><dd>${esc(t.basis)}</dd></div>
        <div><dt class="text-slate-500">Label tahun/versi</dt><dd>${esc(t.version_label)}</dd></div>
        <div><dt class="text-slate-500">Skala</dt><dd>${t.score_scale}</dd></div>
      </dl>`,
)}
${card("Prinsip supervisi", `<ol>${principleRows}</ol>
  ${editable ? `<form method="post" action="/admin/templat/${t.id}/prinsip" class="flex flex-col sm:flex-row gap-2 mt-3">
    <textarea class="${inputCls} flex-1" name="text" rows="2" required placeholder="Tambah prinsip baru…"></textarea>
    <button type="submit" class="${btnPrimary}">+ Prinsip</button>
  </form>` : ""}`)}
${card(
  "Elemen &amp; indikator observasi",
  `${elementSections}
  ${editable ? `<form method="post" action="/admin/templat/${t.id}/elemen" class="flex flex-col sm:flex-row gap-2 mt-2">
    <input class="${inputCls} sm:w-24" name="code" required placeholder="Kode (A)" maxlength="10">
    <input class="${inputCls} flex-1" name="title" required placeholder="Judul elemen baru…">
    <button type="submit" class="${btnPrimary}">+ Elemen</button>
  </form>` : ""}`,
)}
${card(
  `Label skala (skala ${t.score_scale})`,
  `<ol>${scaleRows}</ol>
  ${editable ? `<form method="post" action="/admin/templat/${t.id}/skala" class="flex flex-col sm:flex-row gap-2 mt-3">
    <input class="${inputCls} sm:w-24" name="v" type="number" required placeholder="Nilai" title="Nilai skala (${t.score_scale === 100 ? "0–100" : "1–" + t.score_scale})">
    <input class="${inputCls} flex-1" name="label" required placeholder="Label, mis. Teramati dengan Baik">
    <button type="submit" class="${btnPrimary}">+ Label Skala</button>
  </form>` : ""}`,
)}
${card("Pertanyaan pra-observasi", `<ol>${questionList("pra", detail.praQuestions)}</ol>`)}
${card("Pertanyaan pasca-observasi", `<ol>${questionList("pasca", detail.pascaQuestions)}</ol>`)}
${card(
  "Butir rencana tindak lanjut",
  `<ol>${rtlRows}</ol>
  ${editable ? `<form method="post" action="/admin/templat/${t.id}/rtl" class="flex flex-col sm:flex-row gap-2 mt-3">
    <input class="${inputCls} flex-1" name="title" required placeholder="Tambah butir tindak lanjut baru…">
    <button type="submit" class="${btnPrimary}">+ Butir RTL</button>
  </form>` : ""}`,
)}
${card(
  "Rentang predikat (skala 100)",
  `${predicateRows}
  <p class="text-sm text-slate-500 mt-3">Rentang predikat bisa diubah oleh admin atau supervisor di <a class="text-teal-700 font-semibold underline" href="/templat/${t.id}/predikat">halaman predikat</a>. Perubahan hanya berlaku untuk sesi baru; sesi lama memakai snapshot predikatnya.</p>`,
)}
</div>`,
      "templat",
    );
  })

  // ---------- Meta + status + salin + hapus ----------
  .post("/admin/templat/:id", async ({ params, body }: any) => {
    const b = body as Record<string, string>;
    const id = Number(params.id);
    const scale = num(b.score_scale);
    return attempt(
      () =>
        updateTemplateMeta(getPool(), id, {
          title: b.title ?? "",
          basis: b.basis ?? "",
          version_label: b.version_label ?? "",
          score_scale: (scale === 2 || scale === 10 || scale === 100 ? scale : 4) as ScoreScale,
        }),
      `/admin/templat/${id}`,
      "Identitas templat disimpan.",
      `/admin/templat/${id}`,
    );
  })
  .post("/admin/templat/:id/status", async ({ params, body }: any) => {
    const b = body as Record<string, string>;
    const id = Number(params.id);
    const target = b.status as TemplateStatus;
    return attempt(
      () => setTemplateStatus(getPool(), id, target),
      `/admin/templat/${id}`,
      `Status templat diubah menjadi ${target}.`,
      `/admin/templat/${id}`,
    );
  })
  .post("/admin/templat/:id/salin", async ({ params, user }: any) => {
    const id = Number(params.id);
    try {
      const newId = await copyTemplate(getPool(), id, user!.id);
      return redirOk(`/admin/templat/${newId}`, "Templat disalin (status draf). Silakan ubah judul/tahunnya bila perlu.");
    } catch (err) {
      return redirErr(`/admin/templat/${id}`, err instanceof Error ? err.message : "Gagal menyalin templat.");
    }
  })
  .post("/admin/templat/:id/hapus", async ({ params }: any) => {
    const id = Number(params.id);
    return attempt(
      () => deleteTemplate(getPool(), id),
      "/admin/templat",
      "Templat dihapus.",
      `/admin/templat/${id}`,
    );
  })

  // ---------- Anak: prinsip ----------
  .post("/admin/templat/:id/prinsip", async ({ params, body }: any) => {
    const b = body as Record<string, string>;
    const id = Number(params.id);
    return attempt(
      () => addPrinciple(getPool(), id, b.text ?? "").then(() => undefined),
      `/admin/templat/${id}`,
      "Prinsip ditambahkan.",
      `/admin/templat/${id}`,
    );
  })
  .post("/admin/templat/prinsip/:cid", async ({ params, body }: any) => {
    const b = body as Record<string, string>;
    const tid = Number(b.template_id);
    return attempt(
      () => updatePrinciple(getPool(), Number(params.cid), b.text ?? ""),
      `/admin/templat/${tid}`,
      "Prinsip disimpan.",
      `/admin/templat/${tid}`,
    );
  })
  .post("/admin/templat/prinsip/:cid/hapus", async ({ params, body }: any) => {
    const b = body as Record<string, string>;
    const tid = Number(b.template_id);
    return attempt(
      () => deletePrinciple(getPool(), Number(params.cid)),
      `/admin/templat/${tid}`,
      "Prinsip dihapus.",
      `/admin/templat/${tid}`,
    );
  })

  // ---------- Anak: elemen ----------
  .post("/admin/templat/:id/elemen", async ({ params, body }: any) => {
    const b = body as Record<string, string>;
    const id = Number(params.id);
    return attempt(
      () => addElement(getPool(), id, b.code ?? "", b.title ?? "").then(() => undefined),
      `/admin/templat/${id}`,
      "Elemen ditambahkan.",
      `/admin/templat/${id}`,
    );
  })
  .post("/admin/templat/elemen/:cid", async ({ params, body }: any) => {
    const b = body as Record<string, string>;
    const tid = Number(b.template_id);
    return attempt(
      () => updateElement(getPool(), Number(params.cid), b.code ?? "", b.title ?? ""),
      `/admin/templat/${tid}`,
      "Elemen disimpan.",
      `/admin/templat/${tid}`,
    );
  })
  .post("/admin/templat/elemen/:cid/hapus", async ({ params, body }: any) => {
    const b = body as Record<string, string>;
    const tid = Number(b.template_id);
    return attempt(
      () => deleteElement(getPool(), Number(params.cid)),
      `/admin/templat/${tid}`,
      "Elemen beserta indikatornya dihapus.",
      `/admin/templat/${tid}`,
    );
  })

  // ---------- Anak: indikator ----------
  .post("/admin/templat/:id/indikator", async ({ params, body }: any) => {
    const b = body as Record<string, string>;
    const id = Number(params.id);
    return attempt(
      () => addIndicator(getPool(), Number(b.element_id), b.text ?? "").then(() => undefined),
      `/admin/templat/${id}`,
      "Indikator ditambahkan.",
      `/admin/templat/${id}`,
    );
  })
  .post("/admin/templat/indikator/:cid", async ({ params, body }: any) => {
    const b = body as Record<string, string>;
    const tid = Number(b.template_id);
    return attempt(
      () => updateIndicator(getPool(), Number(params.cid), b.text ?? ""),
      `/admin/templat/${tid}`,
      "Indikator disimpan.",
      `/admin/templat/${tid}`,
    );
  })
  .post("/admin/templat/indikator/:cid/hapus", async ({ params, body }: any) => {
    const b = body as Record<string, string>;
    const tid = Number(b.template_id);
    return attempt(
      () => deleteIndicator(getPool(), Number(params.cid)),
      `/admin/templat/${tid}`,
      "Indikator dihapus.",
      `/admin/templat/${tid}`,
    );
  })

  // ---------- Anak: pertanyaan ----------
  .post("/admin/templat/:id/pertanyaan", async ({ params, body }: any) => {
    const b = body as Record<string, string>;
    const id = Number(params.id);
    return attempt(
      () =>
        addQuestion(getPool(), id, b.stage === "pasca" ? "pasca" : "pra", b.text ?? "").then(() => undefined),
      `/admin/templat/${id}`,
      "Pertanyaan ditambahkan.",
      `/admin/templat/${id}`,
    );
  })
  .post("/admin/templat/pertanyaan/:cid", async ({ params, body }: any) => {
    const b = body as Record<string, string>;
    const tid = Number(b.template_id);
    return attempt(
      () => updateQuestion(getPool(), Number(params.cid), b.text ?? ""),
      `/admin/templat/${tid}`,
      "Pertanyaan disimpan.",
      `/admin/templat/${tid}`,
    );
  })
  .post("/admin/templat/pertanyaan/:cid/hapus", async ({ params, body }: any) => {
    const b = body as Record<string, string>;
    const tid = Number(b.template_id);
    return attempt(
      () => deleteQuestion(getPool(), Number(params.cid)),
      `/admin/templat/${tid}`,
      "Pertanyaan dihapus.",
      `/admin/templat/${tid}`,
    );
  })

  // ---------- Anak: RTL ----------
  .post("/admin/templat/:id/rtl", async ({ params, body }: any) => {
    const b = body as Record<string, string>;
    const id = Number(params.id);
    return attempt(
      () => addRtlItem(getPool(), id, b.title ?? "").then(() => undefined),
      `/admin/templat/${id}`,
      "Butir tindak lanjut ditambahkan.",
      `/admin/templat/${id}`,
    );
  })
  .post("/admin/templat/rtl/:cid", async ({ params, body }: any) => {
    const b = body as Record<string, string>;
    const tid = Number(b.template_id);
    return attempt(
      () => updateRtlItem(getPool(), Number(params.cid), b.title ?? ""),
      `/admin/templat/${tid}`,
      "Butir tindak lanjut disimpan.",
      `/admin/templat/${tid}`,
    );
  })
  .post("/admin/templat/rtl/:cid/hapus", async ({ params, body }: any) => {
    const b = body as Record<string, string>;
    const tid = Number(b.template_id);
    return attempt(
      () => deleteRtlItem(getPool(), Number(params.cid)),
      `/admin/templat/${tid}`,
      "Butir tindak lanjut dihapus.",
      `/admin/templat/${tid}`,
    );
  })

  // ---------- Anak: label skala ----------
  .post("/admin/templat/:id/skala", async ({ params, body }: any) => {
    const b = body as Record<string, string>;
    const id = Number(params.id);
    return attempt(
      () => addScaleLevel(getPool(), id, num(b.v), b.label ?? "").then(() => undefined),
      `/admin/templat/${id}`,
      "Label skala ditambahkan.",
      `/admin/templat/${id}`,
    );
  })
  .post("/admin/templat/skala/:cid", async ({ params, body }: any) => {
    const b = body as Record<string, string>;
    const tid = Number(b.template_id);
    return attempt(
      () => updateScaleLevel(getPool(), Number(params.cid), num(b.v), b.label ?? ""),
      `/admin/templat/${tid}`,
      "Label skala disimpan.",
      `/admin/templat/${tid}`,
    );
  })
  .post("/admin/templat/skala/:cid/hapus", async ({ params, body }: any) => {
    const b = body as Record<string, string>;
    const tid = Number(b.template_id);
    return attempt(
      () => deleteScaleLevel(getPool(), Number(params.cid)),
      `/admin/templat/${tid}`,
      "Label skala dihapus.",
      `/admin/templat/${tid}`,
    );
  });

// ---------- Instance predikat (admin ATAU supervisor) ----------

/** Guard: wajib login (+ paksa ganti sandi) lalu peran admin/supervisor. Guru biasa 403. */
function requireAdminOrSupervisor({ user, path }: any) {
  const login = requireAuth({ user, path });
  if (login) return login;
  if (user?.role !== "admin" && !isSupervisor(user)) {
    return new Response("Akses ditolak: halaman ini hanya untuk admin dan supervisor.", {
      status: 403,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
}

export const templatePredicateRoutes = new Elysia()
  .use(authPlugin)
  .onBeforeHandle(requireAdminOrSupervisor)
  .get("/templat", async ({ user, query }: any) => {
    const templates = await listTemplates(getPool());
    const msg = msgFromQuery(query as Record<string, string>);
    return html(
      user!,
      await schoolName(),
      `
<h1 class="text-2xl font-bold text-slate-900 mb-6">Templat Instrumen</h1>
${msg ? alertBox(query.ok ? "ok" : "err", msg) : ""}
<p class="text-sm text-slate-600 mb-4">Daftar templat (baca saja). Rentang predikat bisa diubah oleh admin atau supervisor di halaman predikat masing-masing templat; perubahan hanya berlaku untuk sesi baru.</p>
${card(
  "Daftar templat",
  templates.length === 0
    ? `<p class="text-sm text-slate-500">Belum ada templat.</p>`
    : `<div class="overflow-x-auto"><table class="w-full text-sm">
      <thead><tr class="text-left text-slate-500 border-b">
        <th class="py-2 pr-2">Templat</th><th class="py-2 pr-2">Skala</th><th class="py-2 pr-2">Status</th><th class="py-2"></th></tr></thead>
      <tbody>${templates
        .map(
          (t) => `<tr class="border-b border-slate-100">
          <td class="py-2 pr-2 font-medium">${esc(t.title)}${t.is_seed ? ' <span class="text-xs text-teal-700 font-semibold">· Bawaan</span>' : ""}</td>
          <td class="py-2 pr-2">${t.score_scale}</td>
          <td class="py-2 pr-2">${STATUS_BADGE[t.status]}</td>
          <td class="py-2 text-right">${t.status === "arsip" ? '<span class="text-xs text-slate-400">Arsip — predikat tidak bisa diubah</span>' : `<a class="${btnGhost}" href="/templat/${t.id}/predikat">Ubah Predikat</a>`}</td>
        </tr>`,
        )
        .join("")}</tbody></table></div>`,
)}
`,
      "templat",
    );
  })
  .get("/templat/:id/predikat", async ({ user, params, query }: any) => {
    const id = Number(params.id);
    let detail;
    try {
      detail = await loadTemplateDetail(getPool(), id);
    } catch {
      return new Response("Templat tidak ditemukan.", { status: 404 });
    }
    const t = detail.template;
    const editable = t.status !== "arsip";
    const msg = msgFromQuery(query as Record<string, string>);
    const rows = detail.predicates
      .map(
        (p) => `<li class="py-2 border-b border-slate-100 last:border-0">
        ${editable
          ? `<form method="post" action="/templat/${t.id}/predikat/${p.id}" class="flex flex-col sm:flex-row gap-2 items-start sm:items-center">
              <input class="${inputCls} sm:w-24" name="min" type="number" step="0.01" value="${p.min}" required title="Batas bawah (skala 100)">
              <span class="text-slate-400 pt-2.5">–</span>
              <input class="${inputCls} sm:w-24" name="max" type="number" step="0.01" value="${p.max}" required title="Batas atas (skala 100)">
              <input class="${inputCls} flex-1" name="label" value="${esc(p.label)}" required>
              <span class="flex gap-2"><button type="submit" class="${btnGhost}">Simpan</button>
              <button type="submit" formaction="/templat/${t.id}/predikat/${p.id}/hapus" formmethod="post" class="${btnDanger}" onclick="return confirm('Hapus predikat ${esc(p.label)}?')">Hapus</button></span>
            </form>`
          : `<span class="text-sm"><span class="font-semibold">${p.min}–${p.max}</span> — ${esc(p.label)}</span>`}
      </li>`,
      )
      .join("");
    return html(
      user!,
      await schoolName(),
      `
<p class="mb-4"><a class="text-teal-700 font-semibold underline text-sm" href="/templat">← Daftar templat</a>${user!.role === "admin" ? ` · <a class="text-teal-700 font-semibold underline text-sm" href="/admin/templat/${t.id}">Kelola templat (admin)</a>` : ""}</p>
<h1 class="text-2xl font-bold text-slate-900 mb-1">Predikat — ${esc(t.title)}</h1>
<p class="text-sm text-slate-500 mb-4">${STATUS_BADGE[t.status]} <span class="ml-2">Skala ${t.score_scale}</span></p>
${msg ? alertBox(query.ok ? "ok" : "err", msg) : ""}
${!editable ? alertBox("info", "Templat arsip: rentang predikat tidak bisa diubah.") : ""}
${card(
  "Rentang predikat (skala 100)",
  `<ol>${rows || `<li class="text-sm text-slate-500">Belum ada rentang predikat.</li>`}</ol>
  ${editable ? `<form method="post" action="/templat/${t.id}/predikat/tambah" class="flex flex-col sm:flex-row gap-2 mt-3 items-start sm:items-center">
    <input class="${inputCls} sm:w-24" name="min" type="number" step="0.01" required placeholder="Min" title="Batas bawah (0–100)">
    <span class="text-slate-400 pt-2.5">–</span>
    <input class="${inputCls} sm:w-24" name="max" type="number" step="0.01" required placeholder="Maks" title="Batas atas (0–100)">
    <input class="${inputCls} flex-1" name="label" required placeholder="Label predikat, mis. Sangat Baik">
    <button type="submit" class="${btnPrimary}">+ Predikat</button>
  </form>
  <p class="text-xs text-slate-400 mt-3">Rentang tidak boleh tumpang tindih. Celah antar rentang dibolehkan — nilai akhir yang jatuh di celah tampil tanpa predikat ("—"). Perubahan hanya berlaku untuk sesi baru; sesi lama memakai snapshot predikatnya.</p>` : ""}`,
)}
`,
      "templat",
    );
  })
  .post("/templat/:id/predikat/tambah", async ({ params, body }: any) => {
    const b = body as Record<string, string>;
    const id = Number(params.id);
    return attempt(
      () =>
        addPredicate(getPool(), id, { min: num(b.min), max: num(b.max), label: b.label ?? "" }).then(
          () => undefined,
        ),
      `/templat/${id}/predikat`,
      "Predikat ditambahkan.",
      `/templat/${id}/predikat`,
    );
  })
  .post("/templat/:id/predikat/:pid", async ({ params, body }: any) => {
    const b = body as Record<string, string>;
    const id = Number(params.id);
    return attempt(
      () =>
        updatePredicate(getPool(), Number(params.pid), {
          min: num(b.min),
          max: num(b.max),
          label: b.label ?? "",
        }),
      `/templat/${id}/predikat`,
      "Predikat disimpan.",
      `/templat/${id}/predikat`,
    );
  })
  .post("/templat/:id/predikat/:pid/hapus", async ({ params }: any) => {
    const id = Number(params.id);
    return attempt(
      () => deletePredicate(getPool(), Number(params.pid)),
      `/templat/${id}/predikat`,
      "Predikat dihapus.",
      `/templat/${id}/predikat`,
    );
  });
