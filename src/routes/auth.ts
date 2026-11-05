import { Elysia } from "elysia";
import type { RowDataPacket } from "mysql2/promise";
import { getPool } from "../db";
import {
  SESSION_COOKIE,
  authenticate,
  clearSessionCookie,
  createSession,
  destroySession,
  getSessionUser,
  hashPassword,
  sessionCookie,
  verifyPassword,
} from "../auth";
import { alertBox, btnPrimary, card, inputCls, labelCls, layout } from "../views";

/** Plugin: memuat user dari cookie sesi ke context `user`.
 * `.as("global")` WAJIB: tanpa itu derive di dalam instance plugin TIDAK
 * mengalir ke route app yang memakai plugin ini (Elysia 1.4: instance
 * plugin default bersifat scoped; derive-nya hanya berlaku untuk route
 * di dalam instance itu sendiri). Terverifikasi empiris 2026-11-05. */
export const authPlugin = new Elysia({ name: "auth" }).derive(
  async ({ cookie }: any) => {
    const token = cookie[SESSION_COOKIE]?.value as string | undefined;
    const user = await getSessionUser(getPool(), token);
    return { user };
  },
).as("global");

export function redirectTo(location: string): Response {
  return new Response(null, { status: 302, headers: { Location: location } });
}

/**
 * Guard login — dipakai sebagai `.onBeforeHandle(requireAuth)` pada
 * instance route yang sama (bukan `.use()`, karena onBeforeHandle di
 * dalam instance plugin scoped tidak berjalan untuk route pemakai —
 * terverifikasi empiris 2026-11-05: guard plugin scoped adalah no-op).
 */
export function requireAuth({ user, path }: any) {
  if (!user) return redirectTo("/login");
  if (
    user.must_change_password &&
    path !== "/ganti-sandi" &&
    !path.startsWith("/ganti-sandi")
  ) {
    return redirectTo("/ganti-sandi");
  }
}

/** Guard admin: wajib login (+ paksa ganti sandi) lalu peran admin. */
export function requireAdmin({ user, path }: any) {
  const login = requireAuth({ user, path });
  if (login) return login;
  if (user?.role !== "admin") {
    return new Response("Akses ditolak: halaman ini hanya untuk admin.", {
      status: 403,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
}

function loginPage(schoolName: string, error?: string): string {
  return layout({
    title: "Masuk",
    user: null,
    schoolName,
    body: `
<div class="max-w-md mx-auto mt-6 sm:mt-12">
  <div class="bg-white rounded-2xl border border-slate-200 p-6 sm:p-8 shadow-sm">
    <h1 class="text-2xl font-bold text-slate-900">Masuk</h1>
    <p class="text-sm text-slate-500 mt-1">Supervisi Akademik · ${schoolName}</p>
    ${error ? alertBox("err", error) : ""}
    <form method="post" action="/login" class="mt-6 space-y-4">
      <div>
        <label class="${labelCls}" for="username">Username</label>
        <input class="${inputCls}" id="username" name="username" autocomplete="username" required autofocus>
      </div>
      <div>
        <label class="${labelCls}" for="password">Kata sandi</label>
        <input class="${inputCls}" id="password" name="password" type="password" autocomplete="current-password" required>
      </div>
      <button type="submit" class="${btnPrimary} w-full">Masuk</button>
    </form>
    <p class="text-xs text-slate-400 mt-4">Login memakai username + kata sandi. Akun dibuat oleh admin.</p>
  </div>
</div>`,
  });
}

export const authRoutes = new Elysia()
  .use(authPlugin)
  .get("/login", async ({ user, cookie }: any) => {
    if (user) return redirectTo("/");
    const [rows] = await getPool().query<(RowDataPacket & { school_name: string })[]>(
      "SELECT school_name FROM settings WHERE id = 1",
    );
    return new Response(
      loginPage(rows[0]?.school_name ?? "SMPN 1 Punggur"),
      { headers: { "Content-Type": "text/html; charset=utf-8" } },
    );
  })
  .post("/login", async ({ body, set }: any) => {
    const { username, password } = body as { username?: string; password?: string };
    const pool = getPool();
    const [rows] = await pool.query<(RowDataPacket & { school_name: string })[]>(
      "SELECT school_name FROM settings WHERE id = 1",
    );
    const schoolName = rows[0]?.school_name ?? "SMPN 1 Punggur";
    if (!username || !password) {
      set.status = 400;
      return new Response(loginPage(schoolName, "Username dan kata sandi wajib diisi."), {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }
    const user = await authenticate(pool, username, password);
    if (!user) {
      set.status = 401;
      return new Response(loginPage(schoolName, "Username atau kata sandi salah."), {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }
    const { token } = await createSession(pool, user.id);
    const secure = process.env.SESSION_COOKIE_SECURE === "true";
    const dest = user.must_change_password ? "/ganti-sandi" : "/";
    return new Response(null, {
      status: 302,
      headers: {
        Location: dest,
        "Set-Cookie": sessionCookie(token, secure),
      },
    });
  })
  .post("/logout", async ({ cookie }: any) => {
    const token = cookie[SESSION_COOKIE]?.value as string | undefined;
    if (token) await destroySession(getPool(), token);
    return new Response(null, {
      status: 302,
      headers: { Location: "/login", "Set-Cookie": clearSessionCookie() },
    });
  })
  .onBeforeHandle(requireAuth)
  .get("/ganti-sandi", async ({ user }: any) => {
    const pool = getPool();
    const [rows] = await pool.query<(RowDataPacket & { school_name: string })[]>(
      "SELECT school_name FROM settings WHERE id = 1",
    );
    const body = `
<div class="max-w-md mx-auto mt-6">
  ${card(
    "Ganti Kata Sandi",
    `
    ${user!.must_change_password ? alertBox("info", "Akun Anda wajib ganti kata sandi sebelum melanjutkan.") : ""}
    <form method="post" action="/ganti-sandi" class="space-y-4">
      <div>
        <label class="${labelCls}" for="old">Kata sandi lama</label>
        <input class="${inputCls}" id="old" name="old_password" type="password" autocomplete="current-password" required>
      </div>
      <div>
        <label class="${labelCls}" for="new">Kata sandi baru (min. 6 karakter)</label>
        <input class="${inputCls}" id="new" name="new_password" type="password" autocomplete="new-password" required>
      </div>
      <div>
        <label class="${labelCls}" for="confirm">Ulangi kata sandi baru</label>
        <input class="${inputCls}" id="confirm" name="confirm_password" type="password" autocomplete="new-password" required>
      </div>
      <button type="submit" class="${btnPrimary} w-full">Simpan Kata Sandi Baru</button>
    </form>`,
  )}
</div>`;
    return new Response(
      layout({
        title: "Ganti Sandi",
        user: user!,
        schoolName: rows[0]?.school_name ?? "SMPN 1 Punggur",
        body,
      }),
      { headers: { "Content-Type": "text/html; charset=utf-8" } },
    );
  })
  .post("/ganti-sandi", async ({ user, body, set }: any) => {
    const pool = getPool();
    const { old_password, new_password, confirm_password } = body as Record<string, string>;
    const [srows] = await pool.query<(RowDataPacket & { school_name: string })[]>(
      "SELECT school_name FROM settings WHERE id = 1",
    );
    const schoolName = srows[0]?.school_name ?? "SMPN 1 Punggur";
    const fail = (msg: string, status = 400) => {
      set.status = status;
      return new Response(
        layout({
          title: "Ganti Sandi",
          user: user!,
          schoolName,
          body: `<div class="max-w-md mx-auto mt-6">${card("Ganti Kata Sandi", alertBox("err", msg) + `<a class="${btnPrimary}" href="/ganti-sandi">Kembali</a>`)}</div>`,
        }),
        { headers: { "Content-Type": "text/html; charset=utf-8" } },
      );
    };
    if (!old_password || !new_password || new_password.length < 6) {
      return fail("Kata sandi baru minimal 6 karakter.");
    }
    if (new_password !== confirm_password) {
      return fail("Konfirmasi kata sandi baru tidak sama.");
    }
    const [rows] = await pool.query<(RowDataPacket & { password_hash: string })[]>(
      "SELECT password_hash FROM users WHERE id = ?",
      [user!.id],
    );
    if (!rows[0] || !(await verifyPassword(old_password, rows[0].password_hash))) {
      return fail("Kata sandi lama salah.", 401);
    }
    const hash = await hashPassword(new_password);
    await pool.query(
      "UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?",
      [hash, user!.id],
    );
    return redirectTo("/");
  });
