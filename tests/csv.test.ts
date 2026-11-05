import { describe, expect, test } from "bun:test";
import { parseCsv, validateGuruCsv, validateKelasCsv } from "../src/lib/csv";

describe("parseCsv", () => {
  test("memisahkan kolom dan baris sederhana", () => {
    const { headers, rows } = parseCsv("a,b,c\n1,2,3\n4,5,6\n");
    expect(headers).toEqual(["a", "b", "c"]);
    expect(rows).toEqual([
      ["1", "2", "3"],
      ["4", "5", "6"],
    ]);
  });

  test("menangani petik, koma di dalam petik, dan CRLF", () => {
    const { headers, rows } = parseCsv(
      'nama,keterangan\r\n"Helmi, S.Pd","guru ""senior"""\r\nRoyan,baru\r\n',
    );
    expect(headers).toEqual(["nama", "keterangan"]);
    expect(rows[0]).toEqual(["Helmi, S.Pd", 'guru "senior"']);
    expect(rows[1]).toEqual(["Royan", "baru"]);
  });

  test("mengabaikan baris kosong dan BOM", () => {
    const { headers, rows } = parseCsv("\uFEFFa,b\n\n1,2\n\n");
    expect(headers).toEqual(["a", "b"]);
    expect(rows).toEqual([["1", "2"]]);
  });
});

describe("validateGuruCsv", () => {
  test("menerima CSV guru yang valid", () => {
    const r = validateGuruCsv(
      "username,nama,nip,password_awal\nhelmi,Helmi Wijayanti,123,\nroyan,Royan,,rahasia\n",
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.rows).toHaveLength(2);
      expect(r.rows[0]!.username).toBe("helmi");
      expect(r.rows[1]!.password_awal).toBe("rahasia");
    }
  });

  test("menolak bila kolom wajib hilang", () => {
    const r = validateGuruCsv("username,nama\nhelmi,Helmi\n");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      // Validator melaporkan kolom wajib sesuai urutan daftar wajib
      // (nip sebelum password_awal); yang penting keduanya disebut.
      const semua = r.errors.map((e) => e.message).join("; ");
      expect(semua).toContain("nip");
      expect(semua).toContain("password_awal");
    }
  });

  test("menolak username duplikat dan nama kosong, dengan nomor baris", () => {
    const r = validateGuruCsv("username,nama,nip,password_awal\nhelmi,Helmi,,\nhelmi,Helmi 2,,\nroyan,,,\n");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.some((e) => e.row === 3 && e.message.includes("duplikat"))).toBe(true);
      expect(r.errors.some((e) => e.row === 4 && e.message.includes("nama kosong"))).toBe(true);
    }
  });
});

describe("validateKelasCsv", () => {
  test("menerima CSV kelas yang valid dan menolak duplikat", () => {
    expect(validateKelasCsv("nama_kelas,level_label\n7.1,Kelas 7\n").ok).toBe(true);
    const r = validateKelasCsv("nama_kelas,level_label\n7.1,Kelas 7\n7.1,Kelas 7\n");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]!.message).toContain("duplikat");
  });
});
