import { Elysia } from "elysia";
import { getPool } from "../db";
import { authPlugin, requireAuth } from "./auth";
import type { RowDataPacket } from "mysql2/promise";
import { esc } from "../views";
import {
  canEditNarrative,
  getNarrativeForDisplay,
} from "../lib/narrative";
import { canViewSession, loadSessionDetail, loadSnapshot } from "../lib/sessions";
import { elementScores, finalScore100, predicateFor } from "../lib/scores";
import { listEvidence } from "../lib/evidence";
import { kopBlock, toKopSettings } from "../lib/kop";

/**
 * Halaman cetak — Fase 4 (plan bagian 8).
 *
 * Susunan mengikuti dokumen kertas: kop sekolah dari pengaturan,
 * identitas 8 kolom, prinsip, tabel pra-observasi, tabel observasi
 * (skor + bukti), tabel pasca (refleksi guru berdampingan dengan
 * catatan supervisor), tindak lanjut, narasi, foto bukti, tempat +
 * tanggal, blok tanda tangan Kepala / Guru / Supervisor dengan NIP.
 *
 * HTML mandiri (bukan layout aplikasi) + CSS print inline: toolbar
 * dan form edit disembunyikan saat mencetak, page-break yang waras.
 * PDF dihasilkan lewat dialog print browser — tanpa pustaka PDF server.
 */

const BULAN_ID = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];

/** Format tanggal YYYY-MM-DD menjadi "6 November 2026" (tanpa geser zona waktu). */
export function formatTanggalId(iso: string | null | undefined): string {
  if (!iso) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  return `${Number(m[3])} ${BULAN_ID[Number(m[2]) - 1]} ${m[1]}`;
}

const PRINT_CSS = `
  * { box-sizing: border-box; }
  body { font-family: "Times New Roman", Times, serif; color: #111; margin: 0; background: #fff; }
  .sheet { max-width: 820px; margin: 0 auto; padding: 16px 20px 32px; }
  h1 { font-size: 20px; text-align: center; margin: 4px 0 2px; text-transform: uppercase; }
  h2 { font-size: 15px; margin: 22px 0 8px; page-break-after: avoid; }
  h3 { font-size: 14px; margin: 14px 0 6px; page-break-after: avoid; }
  p { font-size: 13px; line-height: 1.5; margin: 4px 0; }
  .kop { text-align: center; border-bottom: 3px double #111; padding-bottom: 10px; margin-bottom: 14px; }
  .kop .nama { font-size: 22px; font-weight: bold; text-transform: uppercase; }
  .kop .alamat { font-size: 12px; color: #333; }
  .kop-gambar { margin-bottom: 14px; }
  .kop-gambar img { width: 100%; height: auto; display: block; }
  .subjudul { text-align: center; font-size: 13px; margin: 2px 0; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; margin: 6px 0; }
  th, td { border: 1px solid #555; padding: 6px 8px; text-align: left; vertical-align: top; overflow-wrap: break-word; }
  th { background: #eee; }
  tr { page-break-inside: avoid; }
  .identitas td:first-child { width: 180px; font-weight: bold; background: #f7f7f7; }
  .narasi { white-space: pre-wrap; text-align: justify; }
  .ttd { width: 100%; margin-top: 28px; page-break-inside: avoid; }
  .ttd td { border: none; text-align: center; vertical-align: top; padding: 6px; }
  .ttd .nama { margin-top: 64px; font-weight: bold; text-decoration: underline; }
  .foto { display: inline-block; margin: 4px 8px 4px 0; text-align: center; font-size: 11px; }
  .foto img { max-width: 180px; max-height: 180px; border: 1px solid #999; }
  .toolbar { position: sticky; top: 0; z-index: 10; background: #0f766e; color: #fff; padding: 10px 16px; display: flex; flex-wrap: wrap; gap: 8px; align-items: center; justify-content: space-between; font-family: system-ui, sans-serif; }
  .toolbar a, .toolbar button { background: #fff; color: #0f766e; border: none; border-radius: 8px; padding: 8px 14px; font-weight: 600; cursor: pointer; text-decoration: none; font-size: 14px; }
  .edit-narasi { background: #f0fdfa; border: 1px solid #99f6e4; border-radius: 12px; padding: 12px 14px; margin-top: 10px; font-family: system-ui, sans-serif; }
  .edit-narasi textarea { width: 100%; min-height: 120px; border: 1px solid #cbd5e1; border-radius: 8px; padding: 8px; font-size: 14px; font-family: system-ui, sans-serif; }
  .edit-narasi button { background: #0f766e; color: #fff; border: none; border-radius: 8px; padding: 8px 14px; font-weight: 600; cursor: pointer; margin-top: 8px; }
  @media print {
    .no-print { display: none !important; }
    .sheet { max-width: none; padding: 0; }
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    @page { margin: 18mm 16mm; }
  }
`;

export const printRoutes = new Elysia().use(authPlugin).onBeforeHandle(requireAuth)
  .get("/supervisi/:id/cetak", async ({ user, params, query }: any) => {
    const id = Number(params.id);
    const pool = getPool();
    const s = await loadSessionDetail(pool, id);
    if (!s) return new Response("Sesi tidak ditemukan.", { status: 404 });
    if (!canViewSession(user!, s)) return new Response("Anda tidak berhak melihat sesi ini.", { status: 403 });

    const [settingsRows] = await pool.query<
      (RowDataPacket & {
        school_name: string;
        school_address: string | null;
        principal_name: string | null;
        signature_place: string;
        kop_path: string | null;
      })[]
    >("SELECT * FROM settings WHERE id = 1");
    const st = settingsRows[0] ?? {
      school_name: "SMPN 1 Punggur",
      school_address: null,
      principal_name: null,
      signature_place: "Seputih Agung",
      kop_path: null,
    };
    // Kop laporan: gambar bila ada, bila tidak kop teks (nama + alamat).
    // Baris settings sudah dibaca di atas (SELECT *), jadi tidak perlu query lagi.
    const kopSettings = toKopSettings(st);
    const [nipRows] = await pool.query<(RowDataPacket & { id: number; nip: string | null })[]>(
      "SELECT id, nip FROM users WHERE id IN (?, ?)",
      [s.supervisor_id, s.teacher_id],
    );
    const nipById = new Map(nipRows.map((r) => [r.id, r.nip ?? ""]));
    // Kepala Sekolah: pakai akun supervisor berflag Kepsek bila ada
    // (nama + NIP-nya); bila belum ada, pakai nama dari pengaturan.
    const [kepsekRows] = await pool.query<
      (RowDataPacket & { name: string; nip: string | null })[]
    >(
      "SELECT name, nip FROM users WHERE role = 'guru' AND is_principal = 1 AND active = 1 ORDER BY id LIMIT 1",
    );
    const kepalaName = kepsekRows[0]?.name ?? st.principal_name ?? "";
    const kepalaNip = kepsekRows[0]?.nip ?? "";
    const snap = await loadSnapshot(pool, id);
    const narrative = await getNarrativeForDisplay(pool, id);
    const evidence = await listEvidence(pool, id);
    const flat = snap.elements.flatMap((el) => el.indicators);
    const overall = elementScores(flat);
    const final = finalScore100(flat, snap.scaleLevels);
    const predikat = predicateFor(final, snap.predicates);
    const labelFor = (v: number | null): string => {
      if (v === null) return "—";
      const lvl = snap.scaleLevels.find((l) => l.v === v);
      return lvl ? `${v} — ${lvl.label}` : String(v);
    };
    const msg = query.ok
      ? decodeURIComponent(query.ok as string)
      : query.err
        ? decodeURIComponent(query.err as string)
        : "";
    const msgCls = query.ok ? "background:#dcfce7;color:#166534" : "background:#fee2e2;color:#991b1b";

    const body = `
<div class="toolbar no-print">
  <span><b>Pratinjau Cetak</b> — ${esc(s.teacher_name)} · ${esc(s.class_name)}</span>
  <span style="display:flex;gap:8px;flex-wrap:wrap">
    <a href="/supervisi/${s.id}">← Ringkasan</a>
    <button type="button" onclick="window.print()">🖨 Cetak / Simpan PDF</button>
  </span>
</div>
<div class="sheet">
  ${msg ? `<p class="no-print" style="padding:10px 14px;border-radius:8px;${msgCls}">${esc(msg)}</p>` : ""}
  ${kopBlock(kopSettings)}
  <h1>Instrumen Supervisi Akademik Pembelajaran</h1>
  ${s.template_basis ? `<p class="subjudul">Berbasis ${esc(s.template_basis)}</p>` : ""}
  <p class="subjudul">${esc(s.template_title)}</p>

  <h2>Identitas</h2>
  <table class="identitas">
    <tr><td>Nama Sekolah</td><td>${esc(st.school_name)}</td></tr>
    <tr><td>Nama Supervisor</td><td>${esc(s.supervisor_name)}</td></tr>
    <tr><td>Nama Guru</td><td>${esc(s.teacher_name)}</td></tr>
    <tr><td>Kelas / Kelompok</td><td>${esc(s.class_name)}</td></tr>
    <tr><td>Hari / Tanggal</td><td>${esc(formatTanggalId(s.observed_at))}${s.observed_time ? ` · ${esc(s.observed_time)}` : ""}</td></tr>
    <tr><td>Tema / Sub Tema (Mata pelajaran)</td><td>${esc(s.subject_theme)}</td></tr>
    <tr><td>Fase / Semester</td><td>${esc(s.phase_semester)}</td></tr>
    <tr><td>Waktu Observasi</td><td>${esc(s.observed_time)}</td></tr>
  </table>

  ${snap.principles.length > 0 ? `<h2>I. Prinsip Supervisi</h2>
  <ol>${snap.principles.map((p) => `<li>${esc(p.text)}</li>`).join("")}</ol>` : ""}

  ${snap.praQuestions.length > 0 ? `<h2>II. Pra-Observasi (Diskusi Pra Observasi)</h2>
  <table>
    <thead><tr><th style="width:36px">No</th><th>Pertanyaan Panduan</th><th>Catatan Diskusi</th></tr></thead>
    <tbody>${snap.praQuestions
      .map((q, i) => `<tr><td>${i + 1}</td><td>${esc(q.text)}</td><td>${esc(q.note) || "—"}</td></tr>`)
      .join("")}</tbody>
  </table>` : ""}

  <h2>III. Observasi</h2>
  ${snap.elements
    .map((el) => {
      const sc = overall.find((o) => o.element_code === el.code);
      return `<h3>${esc(el.code)}. ${esc(el.title)}${sc && sc.average !== null ? ` — rata-rata ${sc.average.toFixed(2)} dari ${s.template_scale}` : ""}</h3>
      <table>
        <thead><tr><th style="width:36px">No</th><th>Indikator</th><th style="width:190px">Skor</th><th>Bukti / Catatan</th></tr></thead>
        <tbody>${el.indicators
          .map(
            (ind, i) =>
              `<tr><td>${i + 1}</td><td>${esc(ind.text)}</td><td>${esc(labelFor(ind.value))}</td><td>${esc(ind.evidence) || "—"}</td></tr>`,
          )
          .join("")}</tbody>
      </table>`;
    })
    .join("")}
  <p><b>Nilai akhir:</b> ${final === null ? "belum lengkap" : `${final.toFixed(1)} / 100 — ${esc(predikat)}`}</p>

  <h2>IV. Pasca-Observasi (Coaching Clinic)</h2>
  <table>
    <thead><tr><th style="width:36px">No</th><th>Pertanyaan Reflektif</th><th>Refleksi Guru</th><th>Catatan Supervisor</th></tr></thead>
    <tbody>${snap.pascaQuestions
      .map(
        (q, i) =>
          `<tr><td>${i + 1}</td><td>${esc(q.text)}</td><td>${esc(q.guru_note) || "—"}</td><td>${esc(q.supervisor_note) || "—"}</td></tr>`,
      )
      .join("")}</tbody>
  </table>

  <h2>V. Rencana Tindak Lanjut</h2>
  <table>
    <thead><tr><th style="width:36px">No</th><th>Butir</th><th>Catatan</th></tr></thead>
    <tbody>${snap.rtlItems
      .map((r, i) => `<tr><td>${i + 1}</td><td>${esc(r.title)}</td><td>${esc(r.note) || "—"}</td></tr>`)
      .join("")}</tbody>
  </table>

  <h2>Narasi Hasil Supervisi</h2>
  <p class="narasi">${esc(narrative.text)}</p>
  ${canEditNarrative(user!, s)
    ? `<div class="edit-narasi no-print">
      <form method="post" action="/supervisi/${s.id}/narasi">
        <input type="hidden" name="redirect" value="cetak">
        <label for="narasi-cetak" style="font-weight:600">Edit narasi (hanya supervisor pembuat sesi)</label>
        <textarea id="narasi-cetak" name="narasi">${esc(narrative.text)}</textarea>
        <button type="submit">Simpan narasi</button>
      </form>
      <form method="post" action="/supervisi/${s.id}/narasi/buat-ulang" style="margin-top:8px">
        <input type="hidden" name="redirect" value="cetak">
        <button type="submit" onclick="return confirm('Buat ulang narasi dari data sesi saat ini? Narasi hasil edit akan ditimpa.')" style="background:#fff;color:#0f766e;border:1px solid #0f766e">↻ Buat ulang narasi</button>
      </form>
    </div>`
    : ""}

  ${evidence.length > 0
    ? `<h2>Bukti</h2>
      <div>${evidence
        .map((e) =>
          e.kind === "foto"
            ? `<span class="foto"><img src="/bukti/${e.id}" alt="${esc(e.caption ?? "Foto bukti")}"><br>${esc(e.caption ?? "")}</span>`
            : `<p>🎬 <a href="${esc(e.url ?? "")}" style="overflow-wrap:anywhere">${esc(e.caption ?? e.url ?? "")}</a></p>`,
        )
        .join("")}</div>`
    : ""}

  <table class="ttd">
    <tr><td colspan="3" style="text-align:right">${esc(st.signature_place)}, ${esc(formatTanggalId(s.observed_at))}</td></tr>
    <tr>
      <td>Kepala Sekolah<br><br><div class="nama">${esc(kepalaName)}</div><div>NIP. ${esc(kepalaNip)}</div></td>
      <td>Guru<br><br><div class="nama">${esc(s.teacher_name)}</div><div>NIP. ${esc(nipById.get(s.teacher_id) ?? "")}</div></td>
      <td>Supervisor<br><br><div class="nama">${esc(s.supervisor_name)}</div><div>NIP. ${esc(nipById.get(s.supervisor_id) ?? "")}</div></td>
    </tr>
  </table>
</div>`;

    return new Response(
      `<!DOCTYPE html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Cetak · Supervisi ${esc(s.teacher_name)}</title><style>${PRINT_CSS}</style></head><body>${body}</body></html>`,
      { headers: { "Content-Type": "text/html; charset=utf-8" } },
    );
  });
