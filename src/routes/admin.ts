import { Elysia } from "elysia";
import { getPool } from "../db";
import { hashPassword } from "../auth";
import { authPlugin, requireAdmin } from "./auth";
import { importGuruCsv, importKelasCsv } from "../lib/csv";
import type { RowDataPacket } from "mysql2/promise";
import {
  alertBox,
  btnDanger,
  btnGhost,
  btnPrimary,
  card,
  errorList,
  esc,
  inputCls,
  labelCls,
  layout,
} from "../views";

function html(user: NonNullable<Parameters<typeof layout>[0]["user"]>, schoolName: string, body: string, active: string): Response {
  return new Response(layout({ title: "Admin", user, schoolName, body, active }), {
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

export const adminRoutes = new Elysia().use(authPlugin).onBeforeHandle(requireAdmin)
  // ---------- Pengaturan sekolah ----------
  .get("/admin/pengaturan", async ({ user, query }: any) => {
    const [rows] = await getPool().query<
      (RowDataPacket & {
        school_name: string;
        school_address: string | null;
        principal_name: string | null;
        signature_place: string;
      })[]
    >("SELECT * FROM settings WHERE id = 1");
    const s = rows[0]!;
    const msg = msgFromQuery(query as Record<string, string>);
    return html(
      user!,
      s.school_name,
      `
<h1 class="text-2xl font-bold text-slate-900 mb-6">Pengaturan Sekolah</h1>
${msg ? alertBox(query.ok ? "ok" : "err", msg) : ""}
${card(
  "Identitas sekolah",
  `<form method="post" action="/admin/pengaturan" class="space-y-4 max-w-lg">
    <div><label class="${labelCls}">Nama sekolah</label>
      <input class="${inputCls}" name="school_name" value="${esc(s.school_name)}" required></div>
    <div><label class="${labelCls}">Alamat sekolah</label>
      <input class="${inputCls}" name="school_address" value="${esc(s.school_address)}"></div>
    <div><label class="${labelCls}">Nama Kepala Sekolah</label>
      <input class="${inputCls}" name="principal_name" value="${esc(s.principal_name)}" placeholder="Nama kepala sekolah (blok tanda tangan)"></div>
    <div><label class="${labelCls}">Tempat tanda tangan</label>
      <input class="${inputCls}" name="signature_place" value="${esc(s.signature_place)}" required></div>
    <button type="submit" class="${btnPrimary}">Simpan Pengaturan</button>
  </form>`,
)}
`,
      "pengaturan",
    );
  })
  .post("/admin/pengaturan", async ({ body }: any) => {
    const b = body as Record<string, string>;
    await getPool().query(
      `INSERT INTO settings (id, school_name, school_address, principal_name, signature_place)
       VALUES (1, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE school_name = VALUES(school_name),
         school_address = VALUES(school_address),
         principal_name = VALUES(principal_name),
         signature_place = VALUES(signature_place)`,
      [
        b.school_name?.trim() || "SMPN 1 Punggur",
        b.school_address?.trim() || null,
        b.principal_name?.trim() || null,
        b.signature_place?.trim() || "Seputih Agung",
      ],
    );
    return new Response(null, {
      status: 302,
      headers: { Location: "/admin/pengaturan?ok=" + encodeURIComponent("Pengaturan disimpan.") },
    });
  })

  // ---------- Guru ----------
  .get("/admin/guru", async ({ user, query }: any) => {
    const pool = getPool();
    const [users] = await pool.query<
      (RowDataPacket & {
        id: number;
        username: string;
        name: string;
        nip: string | null;
        role: string;
        is_principal: number;
        active: number;
      })[]
    >("SELECT id, username, name, nip, role, is_principal, active FROM users ORDER BY role, name");
    const msg = msgFromQuery(query as Record<string, string>);
    const roleLabel: Record<string, string> = { admin: "Admin", supervisor: "Supervisor", guru: "Guru" };
    return html(
      user!,
      await schoolName(),
      `
<h1 class="text-2xl font-bold text-slate-900 mb-6">Guru &amp; Akun</h1>
${msg ? alertBox(query.ok ? "ok" : "err", msg) : ""}
<div class="grid lg:grid-cols-5 gap-4 items-start">
<div class="lg:col-span-3">
${card(
  "Daftar akun",
  users.length === 0
    ? `<p class="text-sm text-slate-500">Belum ada akun.</p>`
    : `<div class="overflow-x-auto"><table class="w-full text-sm">
      <thead><tr class="text-left text-slate-500 border-b">
        <th class="py-2 pr-2">Nama</th><th class="py-2 pr-2">Username</th>
        <th class="py-2 pr-2">Peran</th><th class="py-2 pr-2">NIP</th><th class="py-2"></th></tr></thead>
      <tbody>${users
        .map(
          (u) => `<tr class="border-b border-slate-100">
          <td class="py-2 pr-2 font-medium">${esc(u.name)}${u.is_principal ? ' <span class="text-xs text-teal-700 font-semibold">· Kepsek</span>' : ""}</td>
          <td class="py-2 pr-2">${esc(u.username)}</td>
          <td class="py-2 pr-2">${roleLabel[u.role] ?? u.role}</td>
          <td class="py-2 pr-2">${esc(u.nip)}</td>
          <td class="py-2 text-right">${u.username === "admin" ? "" : `<form method="post" action="/admin/guru/${u.id}/hapus" onsubmit="return confirm('Hapus akun ${esc(u.username)}? Penugasan terkait ikut terhapus.')" class="inline"><button class="${btnDanger}">Hapus</button></form>`}</td>
        </tr>`,
        )
        .join("")}</tbody></table></div>`,
)}
</div>
<div class="lg:col-span-2 space-y-4">
${card(
  "Tambah akun",
  `<form method="post" action="/admin/guru" class="space-y-3">
    <div><label class="${labelCls}">Username</label><input class="${inputCls}" name="username" required pattern="[a-zA-Z0-9._-]{3,50}" title="3–50 karakter: huruf, angka, titik, _ , -"></div>
    <div><label class="${labelCls}">Nama</label><input class="${inputCls}" name="name" required></div>
    <div><label class="${labelCls}">NIP (opsional)</label><input class="${inputCls}" name="nip"></div>
    <div><label class="${labelCls}">Peran</label>
      <select class="${inputCls}" name="role">
        <option value="guru">Guru</option>
        <option value="supervisor">Supervisor</option>
        <option value="admin">Admin</option>
      </select></div>
    <label class="flex items-center gap-2 text-sm"><input type="checkbox" name="is_principal" value="1" class="accent-teal-600"> Kepala Sekolah (supervisor, bisa mensupervisi semua guru)</label>
    <div><label class="${labelCls}">Kata sandi awal</label><input class="${inputCls}" name="password" type="password" required minlength="6"></div>
    <button type="submit" class="${btnPrimary}">Tambah Akun</button>
    <p class="text-xs text-slate-400">Akun baru ditandai wajib ganti kata sandi saat login pertama.</p>
  </form>`,
)}
${card(
  "Impor CSV guru",
  `<p class="text-sm text-slate-600 mb-3">Kolom: <code>username,nama,nip,password_awal</code>. Bila <code>password_awal</code> kosong, dipakai kata sandi default di bawah. Satu baris salah = seluruh impor dibatalkan.</p>
  <form method="post" action="/admin/guru/impor" enctype="multipart/form-data" class="space-y-3">
    <div><label class="${labelCls}">Berkas CSV</label><input class="${inputCls}" type="file" name="file" accept=".csv,text/csv"></div>
    <div><label class="${labelCls}">atau tempel isi CSV</label><textarea class="${inputCls}" name="csv_text" rows="4" placeholder="username,nama,nip,password_awal"></textarea></div>
    <div><label class="${labelCls}">Kata sandi default (bila password_awal kosong)</label><input class="${inputCls}" name="default_password" type="password" value="guru123" minlength="6"></div>
    <button type="submit" class="${btnPrimary}">Impor</button>
    <a class="${btnGhost}" href="/admin/guru/contoh.csv">Unduh contoh guru.csv</a>
  </form>`,
)}
</div>
</div>`,
      "guru",
    );
  })
  .post("/admin/guru", async ({ body }: any) => {
    const b = body as Record<string, string>;
    const username = (b.username ?? "").trim();
    const name = (b.name ?? "").trim();
    const password = b.password ?? "";
    const role = ["admin", "supervisor", "guru"].includes(b.role ?? "") ? b.role! : "guru";
    const fail = (m: string) =>
      new Response(null, { status: 302, headers: { Location: "/admin/guru?err=" + encodeURIComponent(m) } });
    if (!/^[a-zA-Z0-9._-]{3,50}$/.test(username)) return fail("Username tidak valid (3–50 karakter: huruf, angka, titik, _ , -).");
    if (!name) return fail("Nama wajib diisi.");
    if (password.length < 6) return fail("Kata sandi awal minimal 6 karakter.");
    try {
      const hash = await hashPassword(password);
      await getPool().query(
        `INSERT INTO users (username, name, nip, password_hash, role, is_principal, must_change_password)
         VALUES (?, ?, ?, ?, ?, ?, 1)`,
        [username, name, b.nip?.trim() || null, hash, role, b.is_principal === "1" && role === "supervisor" ? 1 : 0],
      );
    } catch (err) {
      const e = err as { code?: string };
      if (e.code === "ER_DUP_ENTRY") return fail(`Username sudah ada: ${username}`);
      throw err;
    }
    return new Response(null, {
      status: 302,
      headers: { Location: "/admin/guru?ok=" + encodeURIComponent(`Akun ${username} ditambahkan.`) },
    });
  })
  .post("/admin/guru/:id/hapus", async ({ params }: any) => {
    const id = Number(params.id);
    const [rows] = await getPool().query<(RowDataPacket & { username: string })[]>(
      "SELECT username FROM users WHERE id = ?",
      [id],
    );
    if (!rows[0]) {
      return new Response(null, { status: 302, headers: { Location: "/admin/guru?err=" + encodeURIComponent("Akun tidak ditemukan.") } });
    }
    if (rows[0].username === "admin") {
      return new Response(null, { status: 302, headers: { Location: "/admin/guru?err=" + encodeURIComponent("Akun admin tidak boleh dihapus.") } });
    }
    await getPool().query("DELETE FROM users WHERE id = ?", [id]);
    return new Response(null, {
      status: 302,
      headers: { Location: "/admin/guru?ok=" + encodeURIComponent(`Akun ${rows[0].username} dihapus.`) },
    });
  })
  .get("/admin/guru/contoh.csv", () => {
    return new Response("username,nama,nip,password_awal\nhelmi,Helmi Wijayanti,196501011990032001,\nroyan,Royan,,\n", {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="guru.csv"' },
    });
  })
  .post("/admin/guru/impor", async ({ body, set }: any) => {
    const b = body as Record<string, unknown>;
    let text = "";
    const file = b.file as File | undefined;
    if (file && typeof file.text === "function" && file.size > 0) {
      text = await file.text();
    } else if (typeof b.csv_text === "string") {
      text = b.csv_text;
    }
    const defaultPassword = (typeof b.default_password === "string" && b.default_password) || "guru123";
    if (!text.trim()) {
      return new Response(null, { status: 302, headers: { Location: "/admin/guru?err=" + encodeURIComponent("Tidak ada isi CSV (unggah berkas atau tempel teks).") } });
    }
    const result = await importGuruCsv(getPool(), text, defaultPassword, hashPassword);
    if (!result.ok) {
      set.status = 400;
      return new Response(
        layout({
          title: "Admin · Guru",
          user: null,
          schoolName: await schoolName(),
          body: `<div class="max-w-3xl">${errorList(result.errors)}<a class="${btnPrimary}" href="/admin/guru">Kembali ke daftar guru</a></div>`,
        }),
        { headers: { "Content-Type": "text/html; charset=utf-8" } },
      );
    }
    return new Response(null, {
      status: 302,
      headers: { Location: "/admin/guru?ok=" + encodeURIComponent(`${result.inserted} guru berhasil diimpor.`) },
    });
  })

  // ---------- Kelas ----------
  .get("/admin/kelas", async ({ user, query }: any) => {
    const pool = getPool();
    const [periods] = await pool.query<(RowDataPacket & { id: number; name: string; is_active: number })[]>(
      "SELECT id, name, is_active FROM periods ORDER BY id DESC",
    );
    const [classes] = await pool.query<
      (RowDataPacket & {
        id: number;
        name: string;
        level_label: string | null;
        period_name: string;
        period_id: number;
      })[]
    >(
      `SELECT c.id, c.name, c.level_label, p.name AS period_name, c.period_id
       FROM classes c JOIN periods p ON p.id = c.period_id ORDER BY p.id DESC, c.name`,
    );
    const msg = msgFromQuery(query as Record<string, string>);
    return html(
      user!,
      await schoolName(),
      `
<h1 class="text-2xl font-bold text-slate-900 mb-6">Kelas</h1>
${msg ? alertBox(query.ok ? "ok" : "err", msg) : ""}
<div class="grid lg:grid-cols-5 gap-4 items-start">
<div class="lg:col-span-3">
${card(
  "Daftar kelas",
  classes.length === 0
    ? `<p class="text-sm text-slate-500">Belum ada kelas. Buat periode dulu bila belum ada.</p>`
    : `<div class="overflow-x-auto"><table class="w-full text-sm">
      <thead><tr class="text-left text-slate-500 border-b">
        <th class="py-2 pr-2">Kelas</th><th class="py-2 pr-2">Tingkat</th><th class="py-2 pr-2">Periode</th><th class="py-2"></th></tr></thead>
      <tbody>${classes
        .map(
          (c) => `<tr class="border-b border-slate-100">
          <td class="py-2 pr-2 font-medium">${esc(c.name)}</td>
          <td class="py-2 pr-2">${esc(c.level_label)}</td>
          <td class="py-2 pr-2">${esc(c.period_name)}</td>
          <td class="py-2 text-right"><form method="post" action="/admin/kelas/${c.id}/hapus" onsubmit="return confirm('Hapus kelas ${esc(c.name)}?')" class="inline"><button class="${btnDanger}">Hapus</button></form></td>
        </tr>`,
        )
        .join("")}</tbody></table></div>`,
)}
</div>
<div class="lg:col-span-2 space-y-4">
${card(
  "Tambah kelas",
  `<form method="post" action="/admin/kelas" class="space-y-3">
    <div><label class="${labelCls}">Periode</label>
      <select class="${inputCls}" name="period_id" required>
        ${periods.map((p) => `<option value="${p.id}" ${p.is_active ? "selected" : ""}>${esc(p.name)}${p.is_active ? " (aktif)" : ""}</option>`).join("")}
      </select></div>
    <div><label class="${labelCls}">Nama kelas</label><input class="${inputCls}" name="name" required placeholder="mis. 7.1"></div>
    <div><label class="${labelCls}">Tingkat (opsional)</label><input class="${inputCls}" name="level_label" placeholder="mis. Kelas 7"></div>
    <button type="submit" class="${btnPrimary}">Tambah Kelas</button>
  </form>`,
)}
${card(
  "Impor CSV kelas",
  `<p class="text-sm text-slate-600 mb-3">Kolom: <code>nama_kelas,level_label</code>. Kelas masuk ke periode yang dipilih. Satu nama duplikat = seluruh impor dibatalkan.</p>
  <form method="post" action="/admin/kelas/impor" enctype="multipart/form-data" class="space-y-3">
    <div><label class="${labelCls}">Periode tujuan</label>
      <select class="${inputCls}" name="period_id" required>
        ${periods.map((p) => `<option value="${p.id}" ${p.is_active ? "selected" : ""}>${esc(p.name)}${p.is_active ? " (aktif)" : ""}</option>`).join("")}
      </select></div>
    <div><label class="${labelCls}">Berkas CSV</label><input class="${inputCls}" type="file" name="file" accept=".csv,text/csv"></div>
    <div><label class="${labelCls}">atau tempel isi CSV</label><textarea class="${inputCls}" name="csv_text" rows="4" placeholder="nama_kelas,level_label"></textarea></div>
    <button type="submit" class="${btnPrimary}">Impor</button>
    <a class="${btnGhost}" href="/admin/kelas/contoh.csv">Unduh contoh kelas.csv</a>
  </form>`,
)}
</div>
</div>`,
      "kelas",
    );
  })
  .post("/admin/kelas", async ({ body }: any) => {
    const b = body as Record<string, string>;
    const fail = (m: string) =>
      new Response(null, { status: 302, headers: { Location: "/admin/kelas?err=" + encodeURIComponent(m) } });
    const periodId = Number(b.period_id);
    if (!periodId || !(b.name ?? "").trim()) return fail("Periode dan nama kelas wajib diisi.");
    try {
      await getPool().query(
        "INSERT INTO classes (period_id, name, level_label) VALUES (?, ?, ?)",
        [periodId, b.name.trim(), b.level_label?.trim() || null],
      );
    } catch (err) {
      const e = err as { code?: string };
      if (e.code === "ER_DUP_ENTRY") return fail(`Kelas sudah ada di periode ini: ${b.name.trim()}`);
      throw err;
    }
    return new Response(null, {
      status: 302,
      headers: { Location: "/admin/kelas?ok=" + encodeURIComponent(`Kelas ${b.name.trim()} ditambahkan.`) },
    });
  })
  .post("/admin/kelas/:id/hapus", async ({ params }: any) => {
    await getPool().query("DELETE FROM classes WHERE id = ?", [Number(params.id)]);
    return new Response(null, { status: 302, headers: { Location: "/admin/kelas?ok=" + encodeURIComponent("Kelas dihapus.") } });
  })
  .get("/admin/kelas/contoh.csv", () => {
    return new Response("nama_kelas,level_label\n7.1,Kelas 7\n7.2,Kelas 7\n8.1,Kelas 8\n9.1,Kelas 9\n", {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="kelas.csv"' },
    });
  })
  .post("/admin/kelas/impor", async ({ body, set }: any) => {
    const b = body as Record<string, unknown>;
    let text = "";
    const file = b.file as File | undefined;
    if (file && typeof file.text === "function" && file.size > 0) {
      text = await file.text();
    } else if (typeof b.csv_text === "string") {
      text = b.csv_text;
    }
    const periodId = Number(b.period_id);
    if (!text.trim() || !periodId) {
      return new Response(null, { status: 302, headers: { Location: "/admin/kelas?err=" + encodeURIComponent("Isi CSV dan periode tujuan wajib diisi.") } });
    }
    const result = await importKelasCsv(getPool(), text, periodId);
    if (!result.ok) {
      set.status = 400;
      return new Response(
        layout({
          title: "Admin · Kelas",
          user: null,
          schoolName: await schoolName(),
          body: `<div class="max-w-3xl">${errorList(result.errors)}<a class="${btnPrimary}" href="/admin/kelas">Kembali ke daftar kelas</a></div>`,
        }),
        { headers: { "Content-Type": "text/html; charset=utf-8" } },
      );
    }
    return new Response(null, {
      status: 302,
      headers: { Location: "/admin/kelas?ok=" + encodeURIComponent(`${result.inserted} kelas berhasil diimpor.`) },
    });
  })

  // ---------- Periode ----------
  .get("/admin/periode", async ({ user, query }: any) => {
    const [periods] = await getPool().query<
      (RowDataPacket & {
        id: number;
        name: string;
        starts_on: string | null;
        ends_on: string | null;
        is_active: number;
      })[]
    >("SELECT * FROM periods ORDER BY id DESC");
    const msg = msgFromQuery(query as Record<string, string>);
    return html(
      user!,
      await schoolName(),
      `
<h1 class="text-2xl font-bold text-slate-900 mb-6">Periode</h1>
${msg ? alertBox(query.ok ? "ok" : "err", msg) : ""}
<div class="grid lg:grid-cols-5 gap-4 items-start">
<div class="lg:col-span-3">
${card(
  "Daftar periode",
  periods.length === 0
    ? `<p class="text-sm text-slate-500">Belum ada periode.</p>`
    : `<div class="overflow-x-auto"><table class="w-full text-sm">
      <thead><tr class="text-left text-slate-500 border-b">
        <th class="py-2 pr-2">Periode</th><th class="py-2 pr-2">Mulai</th><th class="py-2 pr-2">Selesai</th><th class="py-2 pr-2">Status</th><th class="py-2"></th></tr></thead>
      <tbody>${periods
        .map(
          (p) => `<tr class="border-b border-slate-100">
          <td class="py-2 pr-2 font-medium">${esc(p.name)}</td>
          <td class="py-2 pr-2">${esc(p.starts_on)}</td>
          <td class="py-2 pr-2">${esc(p.ends_on)}</td>
          <td class="py-2 pr-2">${p.is_active ? '<span class="px-2 py-0.5 rounded-full bg-teal-50 text-teal-700 text-xs font-semibold">Aktif</span>' : ""}</td>
          <td class="py-2 text-right">${p.is_active ? "" : `<form method="post" action="/admin/periode/${p.id}/aktifkan" class="inline"><button class="${btnGhost}">Aktifkan</button></form>`}</td>
        </tr>`,
        )
        .join("")}</tbody></table></div>
    <p class="text-xs text-slate-400 mt-3">Tepat satu periode aktif. Mengaktifkan periode baru menonaktifkan periode lama.</p>`,
)}
</div>
<div class="lg:col-span-2">
${card(
  "Tambah periode",
  `<form method="post" action="/admin/periode" class="space-y-3">
    <div><label class="${labelCls}">Nama periode</label><input class="${inputCls}" name="name" required placeholder="mis. 2026/2027 Ganjil"></div>
    <div><label class="${labelCls}">Tanggal mulai</label><input class="${inputCls}" name="starts_on" type="date"></div>
    <div><label class="${labelCls}">Tanggal selesai</label><input class="${inputCls}" name="ends_on" type="date"></div>
    <button type="submit" class="${btnPrimary}">Tambah Periode</button>
  </form>`,
)}
</div>
</div>`,
      "periode",
    );
  })
  .post("/admin/periode", async ({ body }: any) => {
    const b = body as Record<string, string>;
    if (!(b.name ?? "").trim()) {
      return new Response(null, { status: 302, headers: { Location: "/admin/periode?err=" + encodeURIComponent("Nama periode wajib diisi.") } });
    }
    const name = b.name.trim();
    const [dup] = await getPool().query<(RowDataPacket & { id: number })[]>(
      "SELECT id FROM periods WHERE name = ?",
      [name],
    );
    if (dup.length > 0) {
      return new Response(null, { status: 302, headers: { Location: "/admin/periode?err=" + encodeURIComponent("Nama periode sudah ada.") } });
    }
    await getPool().query(
      "INSERT INTO periods (name, starts_on, ends_on) VALUES (?, ?, ?)",
      [name, b.starts_on || null, b.ends_on || null],
    );
    return new Response(null, {
      status: 302,
      headers: { Location: "/admin/periode?ok=" + encodeURIComponent(`Periode ${b.name.trim()} ditambahkan.`) },
    });
  })
  .post("/admin/periode/:id/aktifkan", async ({ params }: any) => {
    const pool = getPool();
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query("UPDATE periods SET is_active = 0");
      await conn.query("UPDATE periods SET is_active = 1 WHERE id = ?", [Number(params.id)]);
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
    return new Response(null, { status: 302, headers: { Location: "/admin/periode?ok=" + encodeURIComponent("Periode diaktifkan.") } });
  })

  // ---------- Penugasan supervisor → guru ----------
  .get("/admin/penugasan", async ({ user, query }: any) => {
    const pool = getPool();
    const [supervisors] = await pool.query<
      (RowDataPacket & { id: number; name: string; username: string; is_principal: number })[]
    >("SELECT id, name, username, is_principal FROM users WHERE role = 'supervisor' AND active = 1 ORDER BY name");
    const [teachers] = await pool.query<(RowDataPacket & { id: number; name: string; username: string })[]>(
      "SELECT id, name, username FROM users WHERE role = 'guru' AND active = 1 ORDER BY name",
    );
    const [rows] = await pool.query<(RowDataPacket & { supervisor_id: number; teacher_id: number })[]>(
      "SELECT supervisor_id, teacher_id FROM supervisor_assignments",
    );
    const assigned = new Map<number, Set<number>>();
    for (const r of rows) {
      if (!assigned.has(r.supervisor_id)) assigned.set(r.supervisor_id, new Set());
      assigned.get(r.supervisor_id)!.add(r.teacher_id);
    }
    const msg = msgFromQuery(query as Record<string, string>);
    const supervisorCards: string[] = [];
    for (const s of supervisors) {
      const mine = assigned.get(s.id) ?? new Set<number>();
      if (s.is_principal) {
        supervisorCards.push(
          card(
            `${esc(s.name)} (${esc(s.username)}) · Kepala Sekolah`,
            `<p class="text-sm text-slate-600">Kepala Sekolah — bisa mensupervisi semua guru, tidak perlu penugasan.</p>`,
          ),
        );
        continue;
      }
      const checks = teachers
        .map(
          (t) =>
            `<label class="flex items-center gap-2 text-sm"><input type="checkbox" name="teacher_ids" value="${t.id}" ${mine.has(t.id) ? "checked" : ""} class="accent-teal-600"> ${esc(t.name)} <span class="text-slate-400">(${esc(t.username)})</span></label>`,
        )
        .join("");
      supervisorCards.push(
        card(
          `${esc(s.name)} (${esc(s.username)})`,
          `<form method="post" action="/admin/penugasan" class="space-y-2">
            <input type="hidden" name="supervisor_id" value="${s.id}">
            ${teachers.length === 0 ? `<p class="text-sm text-slate-500">Belum ada guru.</p>` : checks}
            <button type="submit" class="${btnPrimary}">Simpan Penugasan</button>
          </form>`,
        ),
      );
    }
    return html(
      user!,
      await schoolName(),
      `
<h1 class="text-2xl font-bold text-slate-900 mb-6">Penugasan Supervisor</h1>
${msg ? alertBox(query.ok ? "ok" : "err", msg) : ""}
<p class="text-sm text-slate-600 mb-4">Supervisor hanya boleh membuat sesi supervisi untuk guru yang ditugaskan padanya. Kepala Sekolah (flag Kepsek) bisa mensupervisi semua guru tanpa penugasan.</p>
${
  supervisors.length === 0
    ? card("Belum ada supervisor", `<p class="text-sm text-slate-500">Buat akun supervisor dulu di <a class="text-teal-700 font-semibold underline" href="/admin/guru">menu Guru &amp; Akun</a>.</p>`)
    : supervisorCards.join('<div class="h-4"></div>')
}
`,
      "penugasan",
    );
  })
  .post("/admin/penugasan", async ({ body }: any) => {
    const b = body as Record<string, string | string[]>;
    const supervisorId = Number(b.supervisor_id);
    const raw = b.teacher_ids;
    const teacherIds = (Array.isArray(raw) ? raw : raw ? [raw] : []).map(Number).filter(Boolean);
    const pool = getPool();
    const [sup] = await pool.query<(RowDataPacket & { role: string })[]>(
      "SELECT role FROM users WHERE id = ?",
      [supervisorId],
    );
    if (!sup[0] || sup[0].role !== "supervisor") {
      return new Response(null, { status: 302, headers: { Location: "/admin/penugasan?err=" + encodeURIComponent("Supervisor tidak ditemukan.") } });
    }
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query("DELETE FROM supervisor_assignments WHERE supervisor_id = ?", [supervisorId]);
      for (const tid of teacherIds) {
        await conn.query(
          "INSERT INTO supervisor_assignments (supervisor_id, teacher_id) VALUES (?, ?)",
          [supervisorId, tid],
        );
      }
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
    return new Response(null, {
      status: 302,
      headers: { Location: "/admin/penugasan?ok=" + encodeURIComponent("Penugasan disimpan.") },
    });
  })

  // ---------- Backup ----------
  .get("/admin/backup", async ({ user, query }: any) => {
    const { readdir, stat } = await import("node:fs/promises");
    const path = await import("node:path");
    const dataDir = process.env.DATA_DIR ?? "./data";
    const backupDir = path.join(dataDir, "backups");
    let files: { name: string; size: number; mtime: Date }[] = [];
    try {
      const names = (await readdir(backupDir)).filter((n) => n.endsWith(".sql.gz") || n.endsWith(".tar.gz")).sort().reverse();
      for (const name of names) {
        const st = await stat(path.join(backupDir, name));
        files.push({ name, size: st.size, mtime: st.mtime });
      }
    } catch {
      files = [];
    }
    const msg = msgFromQuery(query as Record<string, string>);
    return html(
      user!,
      await schoolName(),
      `
<h1 class="text-2xl font-bold text-slate-900 mb-6">Backup</h1>
${msg ? alertBox(query.ok ? "ok" : "err", msg) : ""}
${card(
  "Buat backup",
  `<p class="text-sm text-slate-600 mb-3">Backup berisi dump MariaDB (<code>mysqldump</code>) + arsip folder bukti foto (<code>data/bukti</code>), disimpan di <code>data/backups/</code> dengan cap waktu.</p>
  <form method="post" action="/admin/backup/buat"><button type="submit" class="${btnPrimary}">Buat Backup Sekarang</button></form>`,
)}
<div class="h-4"></div>
${card(
  "Riwayat backup",
  files.length === 0
    ? `<p class="text-sm text-slate-500">Belum ada backup.</p>`
    : `<div class="overflow-x-auto"><table class="w-full text-sm">
      <thead><tr class="text-left text-slate-500 border-b"><th class="py-2 pr-2">Berkas</th><th class="py-2 pr-2">Ukuran</th><th class="py-2 pr-2">Waktu</th><th></th></tr></thead>
      <tbody>${files.map((f) => `<tr class="border-b border-slate-100">
        <td class="py-2 pr-2 font-mono text-xs">${esc(f.name)}</td>
        <td class="py-2 pr-2">${(f.size / 1024).toFixed(1)} KB</td>
        <td class="py-2 pr-2">${esc(f.mtime.toLocaleString("id-ID"))}</td>
        <td class="py-2 text-right"><a class="${btnGhost}" href="/admin/backup/unduh/${encodeURIComponent(f.name)}">Unduh</a></td>
      </tr>`).join("")}</tbody></table></div>`,
)}
<p class="text-xs text-slate-400 mt-4">Restore dilakukan dari baris perintah (lihat README) — restore mengganti database dan membersihkan semua sesi login.</p>`,
      "backup",
    );
  })
  .post("/admin/backup/buat", async () => {
    const proc = Bun.spawn(["bash", "deploy/backup.sh"], {
      cwd: process.cwd(),
      stdout: "pipe",
      stderr: "pipe",
    });
    const out = await new Response(proc.stdout).text();
    const err = await new Response(proc.stderr).text();
    await proc.exited;
    if (proc.exitCode !== 0) {
      return new Response(null, {
        status: 302,
        headers: { Location: "/admin/backup?err=" + encodeURIComponent("Backup gagal: " + (err || out).slice(0, 200)) },
      });
    }
    return new Response(null, {
      status: 302,
      headers: { Location: "/admin/backup?ok=" + encodeURIComponent("Backup selesai dibuat.") },
    });
  })
  .get("/admin/backup/unduh/:name", async ({ params, set }: any) => {
    const path = await import("node:path");
    const dataDir = process.env.DATA_DIR ?? "./data";
    const name = params.name;
    if (!/^[A-Za-z0-9._-]+\.(sql\.gz|tar\.gz)$/.test(name)) {
      set.status = 400;
      return "Nama berkas tidak valid.";
    }
    const file = Bun.file(path.join(dataDir, "backups", name));
    if (!(await file.exists())) {
      set.status = 404;
      return "Berkas tidak ditemukan.";
    }
    return new Response(file, {
      headers: { "Content-Disposition": `attachment; filename="${name}"` },
    });
  });
