import type { SessionUser } from "./auth";
import { isSupervisor } from "./rbac";

export function esc(s: string | null | undefined): string {
  return (s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const ROLE_LABEL: Record<string, string> = {
  admin: "Admin",
  guru: "Guru",
};

export function layout(opts: {
  title: string;
  user: SessionUser | null;
  schoolName: string;
  body: string;
  active?: string;
}): string {
  const { title, user, schoolName, body, active } = opts;
  const nav = user
    ? `
      <nav class="flex flex-wrap items-center gap-1 text-sm">
        <a href="/" class="px-3 py-2 rounded-lg ${active === "dasbor" ? "bg-teal-50 text-teal-800 font-semibold" : "text-slate-600 hover:bg-slate-100"}">Dasbor</a>
        <a href="/supervisi" class="px-3 py-2 rounded-lg ${active === "supervisi" ? "bg-teal-50 text-teal-800 font-semibold" : "text-slate-600 hover:bg-slate-100"}">Supervisi</a>
        ${
          user.role === "admin"
            ? `
        <a href="/admin/pengaturan" class="px-3 py-2 rounded-lg ${active === "pengaturan" ? "bg-teal-50 text-teal-800 font-semibold" : "text-slate-600 hover:bg-slate-100"}">Pengaturan</a>
        <a href="/admin/guru" class="px-3 py-2 rounded-lg ${active === "guru" ? "bg-teal-50 text-teal-800 font-semibold" : "text-slate-600 hover:bg-slate-100"}">Guru</a>
        <a href="/admin/kelas" class="px-3 py-2 rounded-lg ${active === "kelas" ? "bg-teal-50 text-teal-800 font-semibold" : "text-slate-600 hover:bg-slate-100"}">Kelas</a>
        <a href="/admin/periode" class="px-3 py-2 rounded-lg ${active === "periode" ? "bg-teal-50 text-teal-800 font-semibold" : "text-slate-600 hover:bg-slate-100"}">Periode</a>
        <a href="/admin/penugasan" class="px-3 py-2 rounded-lg ${active === "penugasan" ? "bg-teal-50 text-teal-800 font-semibold" : "text-slate-600 hover:bg-slate-100"}">Penugasan</a>
        <a href="/admin/templat" class="px-3 py-2 rounded-lg ${active === "templat" ? "bg-teal-50 text-teal-800 font-semibold" : "text-slate-600 hover:bg-slate-100"}">Templat</a>
        <a href="/admin/backup" class="px-3 py-2 rounded-lg ${active === "backup" ? "bg-teal-50 text-teal-800 font-semibold" : "text-slate-600 hover:bg-slate-100"}">Backup</a>
        <a href="/admin/log" class="px-3 py-2 rounded-lg ${active === "log" ? "bg-teal-50 text-teal-800 font-semibold" : "text-slate-600 hover:bg-slate-100"}">Log</a>`
            : ""
        }
        ${
          isSupervisor(user)
            ? `
        <a href="/templat" class="px-3 py-2 rounded-lg ${active === "templat" ? "bg-teal-50 text-teal-800 font-semibold" : "text-slate-600 hover:bg-slate-100"}">Predikat Templat</a>`
            : ""
        }
        <a href="/ganti-sandi" class="px-3 py-2 rounded-lg text-slate-600 hover:bg-slate-100">Ganti Sandi</a>
        <form method="post" action="/logout" class="inline">
          <button type="submit" class="px-3 py-2 rounded-lg text-slate-600 hover:bg-slate-100 cursor-pointer">Keluar</button>
        </form>
      </nav>`
    : "";
  return `<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · gezyspv-pro</title>
<link rel="stylesheet" href="/static/dist/app.css">
</head>
<body class="min-h-screen bg-slate-50 text-slate-800 antialiased">
<header class="bg-white border-b border-slate-200 sticky top-0 z-10">
  <div class="max-w-6xl mx-auto px-4 py-3 flex flex-wrap items-center gap-3 justify-between">
    <a href="/" class="flex items-center gap-3">
      <span class="w-9 h-9 rounded-xl bg-teal-600 text-white flex items-center justify-center font-bold text-lg">S</span>
      <span>
        <span class="block font-bold text-slate-900 leading-tight">gezyspv-pro</span>
        <span class="block text-xs text-slate-500 leading-tight">${esc(schoolName)}</span>
      </span>
    </a>
    ${nav}
    ${user ? `<span class="text-sm text-slate-600">${esc(user.name)} <span class="ml-1 inline-block px-2 py-0.5 rounded-full bg-teal-50 text-teal-700 text-xs font-semibold">${ROLE_LABEL[user.role] ?? user.role}${user.is_supervisor ? " · Supervisor" : ""}${user.is_principal ? " · Kepsek" : ""}</span></span>` : ""}
  </div>
</header>
<main class="max-w-6xl mx-auto px-4 py-6 2xl:max-w-7xl">
${body}
</main>
<footer class="max-w-6xl mx-auto px-4 pb-8 text-center text-xs text-slate-400">
  gezyspv-pro · Supervisi Akademik · spv.pakgun.web.id
</footer>
</body>
</html>`;
}

export function alertBox(kind: "ok" | "err" | "info", text: string): string {
  const cls =
    kind === "ok"
      ? "bg-emerald-50 border-emerald-200 text-emerald-800"
      : kind === "err"
        ? "bg-red-50 border-red-200 text-red-800"
        : "bg-sky-50 border-sky-200 text-sky-800";
  return `<div class="mb-4 px-4 py-3 rounded-xl border text-sm ${cls}">${esc(text)}</div>`;
}

export function errorList(errors: { row: number; message: string }[]): string {
  if (errors.length === 0) return "";
  const items = errors
    .map(
      (e) =>
        `<li>${e.row > 0 ? `Baris ${e.row}: ` : ""}${esc(e.message)}</li>`,
    )
    .join("");
  return `<div class="mb-4 px-4 py-3 rounded-xl border bg-red-50 border-red-200 text-red-800 text-sm">
    <p class="font-semibold mb-1">Impor dibatalkan — tidak ada data yang masuk:</p>
    <ul class="list-disc pl-5 space-y-0.5">${items}</ul>
  </div>`;
}

export function statCard(label: string, value: string | number, sub?: string): string {
  return `<div class="bg-white rounded-2xl border border-slate-200 p-5">
    <p class="text-3xl font-bold text-slate-900">${esc(String(value))}</p>
    <p class="text-sm font-medium text-slate-700 mt-1">${esc(label)}</p>
    ${sub ? `<p class="text-xs text-slate-500 mt-0.5">${esc(sub)}</p>` : ""}
  </div>`;
}

export function card(title: string, body: string, extra = ""): string {
  return `<section class="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 ${extra}">
    <h2 class="text-lg font-bold text-slate-900 mb-3">${esc(title)}</h2>
    ${body}
  </section>`;
}

export const inputCls =
  "w-full px-3 py-2.5 rounded-xl border border-slate-300 bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500";
export const labelCls = "block text-sm font-medium text-slate-700 mb-1";
export const btnPrimary =
  "inline-flex items-center justify-center px-4 py-2.5 rounded-xl bg-teal-600 text-white font-semibold hover:bg-teal-700 cursor-pointer";
export const btnGhost =
  "inline-flex items-center justify-center px-4 py-2.5 rounded-xl border border-slate-300 bg-white font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer";
export const btnDanger =
  "inline-flex items-center justify-center px-3 py-1.5 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm font-semibold hover:bg-red-100 cursor-pointer";
