import { Elysia } from "elysia";
import { readFile } from "node:fs/promises";
import { getPool } from "../db";
import { authPlugin, requireAuth } from "./auth";
import { getKopPath, kopContentType, kopFilePath } from "../lib/kop";

/**
 * GET /kop — sajikan gambar kop laporan (PNG/JPEG).
 * Login wajib; semua peran yang boleh melihat laporan boleh membuka
 * (kop adalah identitas sekolah, bukan data per pengguna).
 * 404 bila belum ada kop diunggah atau berkasnya hilang dari disk.
 */
export const kopRoutes = new Elysia().use(authPlugin).onBeforeHandle(requireAuth)
  .get("/kop", async () => {
    const filename = await getKopPath(getPool());
    if (!filename) return new Response("Belum ada gambar kop.", { status: 404 });
    try {
      const data = await readFile(kopFilePath(filename));
      return new Response(data, {
        headers: {
          "Content-Type": kopContentType(filename),
          "Cache-Control": "private, max-age=3600",
        },
      });
    } catch {
      return new Response("Berkas gambar kop tidak ditemukan di server.", { status: 404 });
    }
  });
