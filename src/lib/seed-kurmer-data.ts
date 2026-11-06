// Data seed 4 instrumen supervisi Kurikulum Merdeka.
//
// SUMBER: ~/workspace/your_files/templat-instrumen-supervisi/seed-templat-instrumen-I-IV.ts
// (berkas seed paralel yang disiapkan 2026-11-06 dan terverifikasi impor
// langsung dengan bun; 12 + 12 + 24 + 38 = 86 butir). Berkas ini adalah
// salinan yang dipakai aplikasi (harus tinggal di repo agar ikut deploy);
// bila sumber paralel berubah, salin ulang dari sana lalu terapkan dua
// penyesuaian di bawah — jangan edit butir manual di sini.
//
// PENYESUAIAN TERHADAP SUMBER PARALEL (terdokumentasi, bukan diam-diam):
//  1. basis = "Kurikulum Merdeka", bukan "Instrumen Supervisi Akademik
//     (Kurikulum Merdeka)" seperti di sumber — karena halaman cetak
//     merender "Berbasis {basis}". Nama lengkap dokumen tetap tersimpan
//     di deskripsi kelompok di bawah.
//  2. Judul elemen III C, F, G, H diberi akhiran "(skala: Tidak Sesuai /
//     Sesuai Sebagian / Sesuai Seluruhnya)" — keputusan Pak Gun yang
//     terkunci: wording label yang berbeda di sebagian kelompok dokumen
//     III tetap tercantum di teks kelompoknya, bukan di label skala.
//     (Sumber paralel tidak mencantumkan akhiran itu.)
//  3. version_label TIDAK ada di data ini — dokumen tidak mencantumkan
//     tahun ajaran. Saat seed berjalan, version_label diisi dari nama
//     periode aktif di /admin/periode (saat ini "2026/2027 Ganjil");
//     bila tidak ada periode aktif, fallback "2026/2027".
//     Lihat resolveKurmerVersionLabel() di ./seed-kurmer.ts.
//
// NORMALISASI DARI SUMBER PARALEL (diwarisi apa adanya — bukan verbatim
// ketat terhadap docx): ejaan tanpa spasi dinormalisasi ("pesertadidik"
// -> "peserta didik", "yanglinear" -> "yang linear", "dataatau" ->
// "data atau", "tehnikdan" -> "tehnik dan", "tindaklanjut" -> "tindak
// lanjut", "instrument" -> "instrumen"); huruf sub-poin IV (a/b/c/...)
// tidak dicantumkan, awalan sub-bagian ("Orientasi — ...") yang dipakai;
// artefak footer "Jumlah Skor Total Nilai Akhir Ketercapaian" di akhir
// dokumen IV tidak dimasukkan. Ejaan "tehnik" dipertahankan.
// Label skala GENERIK untuk keempat templat (DISETUJUI Pak Gun
// 2026-11-06): 0 "Tidak Ada / Tidak Sesuai", 1 "Kurang Lengkap /
// Sesuai Sebagian", 2 "Lengkap / Sesuai".
import type { TemplateSeedData } from "./seed-template";

export const KURMER_GROUP = {
  title: "Instrumen Supervisi Kurikulum Merdeka",
  description: "Paket 4 Instrumen Supervisi Akademik (Kurikulum Merdeka): Administrasi Pembelajaran, Penelaahan Alur Tujuan Pembelajaran, Telaah Modul Ajar, dan Supervisi Pelaksanaan Pembelajaran. Satu supervisi membuka keempat pengisian yang terhubung.",
};

export const KURMER_TEMPLATES: TemplateSeedData[] = [
  {
    "title": "I — Administrasi Pembelajaran",
    "basis": "Kurikulum Merdeka",
    "score_scale": 2,
    "scale_levels": [
      {
        "v": 0,
        "label": "Tidak Ada / Tidak Sesuai"
      },
      {
        "v": 1,
        "label": "Kurang Lengkap / Sesuai Sebagian"
      },
      {
        "v": 2,
        "label": "Lengkap / Sesuai"
      }
    ],
    "principles": [],
    "elements": [
      {
        "code": "A",
        "title": "Administrasi Pembelajaran",
        "indicators": [
          "Kalender Pendidikan",
          "Program Tahunan",
          "Program Semester",
          "Alur Tujuan Pembelajaran",
          "Modul Ajar",
          "Jadwal Tatap Muka",
          "Agenda Mengajar",
          "Daftar Nilai",
          "KKTP",
          "Absensi Siswa",
          "Buku Pegangan Guru",
          "Buku Teks Siswa"
        ]
      }
    ],
    "pra_questions": [],
    "pasca_questions": [
      "Apa tanggapan dan refleksi Anda atas hasil supervisi ini?"
    ],
    "rtl_items": [
      "Catatan",
      "Tindak Lanjut"
    ],
    "predicates": [
      {
        "min": 91,
        "max": 100,
        "label": "Sangat Baik"
      },
      {
        "min": 81,
        "max": 90,
        "label": "Baik"
      },
      {
        "min": 71,
        "max": 80,
        "label": "Cukup"
      },
      {
        "min": 0,
        "max": 70,
        "label": "Kurang"
      }
    ]
  },
  {
    "title": "II — Penelaahan Alur Tujuan Pembelajaran",
    "basis": "Kurikulum Merdeka",
    "score_scale": 2,
    "scale_levels": [
      {
        "v": 0,
        "label": "Tidak Ada / Tidak Sesuai"
      },
      {
        "v": 1,
        "label": "Kurang Lengkap / Sesuai Sebagian"
      },
      {
        "v": 2,
        "label": "Lengkap / Sesuai"
      }
    ],
    "principles": [],
    "elements": [
      {
        "code": "A",
        "title": "Identitas ATP",
        "indicators": [
          "Mencantumkan: nama sekolah, mata pelajaran, Kelas, Semester dan CP."
        ]
      },
      {
        "code": "B",
        "title": "Peta Kompetensi dan Tujuan Pembelajaran",
        "indicators": [
          "Peta Kompetensi sesuai fase usia / pembelajaran",
          "Capaian Pembelajaran",
          "Tujuan Pembelajaran"
        ]
      },
      {
        "code": "C",
        "title": "Komponen ATP",
        "indicators": [
          "ATP mencakup komponen kompetensi",
          "ATP mencakup komponen konten",
          "ATP mencakup komponen variasi"
        ]
      },
      {
        "code": "D",
        "title": "Kriteria ATP",
        "indicators": [
          "Menggambarkan urutan pengembangan kompetensi yang harus dikuasai peserta didik",
          "Alur tujuan pembelajaran dalam satu fase menggambarkan cakupan dan tahapan pembelajaran yang linear dari awal hingga akhir fase",
          "Alur tujuan pembelajaran pada keseluruhan fase menggambarkan cakupan dan tahapan pembelajaran yang menggambarkan tahapan perkembangan kompetensi antarfase dan jenjang",
          "Identifikasi elemen dan atau sub elemen Profil Pelajar Pancasila yang sesuai dengan tujuan pembelajaran yang dirumuskan",
          "Alur Tujuan Pembelajaran"
        ]
      }
    ],
    "pra_questions": [],
    "pasca_questions": [
      "Apa tanggapan dan refleksi Anda atas hasil supervisi ini?"
    ],
    "rtl_items": [
      "Catatan",
      "Tindak Lanjut"
    ],
    "predicates": [
      {
        "min": 91,
        "max": 100,
        "label": "Sangat Baik"
      },
      {
        "min": 81,
        "max": 90,
        "label": "Baik"
      },
      {
        "min": 71,
        "max": 80,
        "label": "Cukup"
      },
      {
        "min": 0,
        "max": 70,
        "label": "Kurang"
      }
    ]
  },
  {
    "title": "III — Telaah Modul Ajar",
    "basis": "Kurikulum Merdeka",
    "score_scale": 2,
    "scale_levels": [
      {
        "v": 0,
        "label": "Tidak Ada / Tidak Sesuai"
      },
      {
        "v": 1,
        "label": "Kurang Lengkap / Sesuai Sebagian"
      },
      {
        "v": 2,
        "label": "Lengkap / Sesuai"
      }
    ],
    "principles": [],
    "elements": [
      {
        "code": "A",
        "title": "Identitas Mata Pelajaran",
        "indicators": [
          "Terdapat: Nama penyusun, institusi, dan tahun disusunnya, kelas, alokasi waktu"
        ]
      },
      {
        "code": "B",
        "title": "Kompetensi Awal dan Profil Pelajar Pancasila",
        "indicators": [
          "Kompetensi Awal",
          "Profil Pelajar Pancasila"
        ]
      },
      {
        "code": "C",
        "title": "Sarana dan Prasarana (skala: Tidak Sesuai / Sesuai Sebagian / Sesuai Seluruhnya)",
        "indicators": [
          "Kesesuaian dan ketepatan penggunaan fasilitas yang dibutuhkan untuk menunjang kegiatan pembelajaran",
          "Kesesuaian dan ketepatan penggunaan materi dan sumber bahan ajar lain yang relevan yang digunakan dalam kegiatan pembelajaran"
        ]
      },
      {
        "code": "D",
        "title": "Target Peserta Didik",
        "indicators": []
      },
      {
        "code": "E",
        "title": "Model Pembelajaran",
        "indicators": [
          "Model pembelajaran tatap muka",
          "Model pembelajaran blended"
        ]
      },
      {
        "code": "F",
        "title": "Komponen Pembelajaran (skala: Tidak Sesuai / Sesuai Sebagian / Sesuai Seluruhnya)",
        "indicators": [
          "Ketepatan Tujuan Pembelajaran",
          "Pemahaman Bermakna",
          "Pertanyaan Pemantik",
          "Persiapan Pembelajaran"
        ]
      },
      {
        "code": "G",
        "title": "Skenario Pembelajaran (skala: Tidak Sesuai / Sesuai Sebagian / Sesuai Seluruhnya)",
        "indicators": [
          "Kegiatan pendahuluan: Motivasi dan Apersepsi",
          "Kegiatan inti berisi: (a) Memfasilitasi kegiatan siswa untuk mengamati, mendengar dan menyimak; (b) Mendorong siswa untuk bertanya apa, mengapa dan bagaimana berbentuk perumusan masalah; (c) Membimbing siswa untuk mengumpulkan informasi/eksplorasi dalam rangka menjawab pertanyaan; (d) Membimbing siswa untuk menyimpulkan/mensintesa data atau informasi yang terkumpul; (e) Memotivasi siswa untuk mengomunikasikan",
          "Kegiatan penutup berisi: rangkuman, refleksi, dan tindak lanjut — (a) Memfasilitasi dan membimbing siswa merangkum materi pelajaran; (b) Memfasilitasi dan membimbing siswa merefleksi kegiatan yang sudah dilaksanakan; (c) Memberikan umpan balik terhadap hasil pembelajaran"
        ]
      },
      {
        "code": "H",
        "title": "Rancangan Penilaian Pembelajaran (skala: Tidak Sesuai / Sesuai Sebagian / Sesuai Seluruhnya)",
        "indicators": [
          "Kesesuaian bentuk, tehnik dan instrumen dengan tujuan pembelajaran",
          "Kesesuaian antara bentuk, tehnik dan instrumen Penilaian Sikap",
          "Kesesuaian antara bentuk, tehnik dan instrumen Penilaian Pengetahuan",
          "Kesesuaian antara bentuk, teknik dan instrumen Penilaian Keterampilan"
        ]
      },
      {
        "code": "I",
        "title": "Pembelajaran Remedial",
        "indicators": [
          "Merumuskan kegiatan pembelajaran remedial yang sesuai dengan karakteristik peserta didik, alokasi waktu, sarana, dan media pembelajaran"
        ]
      },
      {
        "code": "J",
        "title": "Pembelajaran Pengayaan",
        "indicators": [
          "Merumuskan kegiatan pembelajaran pengayaan sesuai dengan karakteristik peserta didik, alokasi waktu, sarana dan media pembelajaran"
        ]
      },
      {
        "code": "K",
        "title": "Lampiran",
        "indicators": [
          "Lembar Kerja Peserta Didik",
          "Bahan Bacaan guru dan Peserta Didik",
          "Glosarium",
          "Daftar Pustaka"
        ]
      }
    ],
    "pra_questions": [],
    "pasca_questions": [
      "Apa tanggapan dan refleksi Anda atas hasil supervisi ini?"
    ],
    "rtl_items": [
      "Catatan",
      "Tindak Lanjut"
    ],
    "predicates": [
      {
        "min": 91,
        "max": 100,
        "label": "Sangat Baik"
      },
      {
        "min": 81,
        "max": 90,
        "label": "Baik"
      },
      {
        "min": 71,
        "max": 80,
        "label": "Cukup"
      },
      {
        "min": 0,
        "max": 70,
        "label": "Kurang"
      }
    ]
  },
  {
    "title": "IV — Supervisi Pelaksanaan Pembelajaran",
    "basis": "Kurikulum Merdeka",
    "score_scale": 2,
    "scale_levels": [
      {
        "v": 0,
        "label": "Tidak Ada / Tidak Sesuai"
      },
      {
        "v": 1,
        "label": "Kurang Lengkap / Sesuai Sebagian"
      },
      {
        "v": 2,
        "label": "Lengkap / Sesuai"
      }
    ],
    "principles": [],
    "elements": [
      {
        "code": "A",
        "title": "Kegiatan Pendahuluan",
        "indicators": [
          "Orientasi — Guru menyiapkan fisik dan psikis peserta didik dengan menyapa dan memberi salam.",
          "Orientasi — Guru menyampaikan rencana kegiatan baik, individual, kerja kelompok, dan melakukan observasi.",
          "Motivasi — Guru mengajukan pertanyaan yang menantang untuk memotivasi Peserta Didik.",
          "Motivasi — Guru menyampaikan manfaat materi pembelajaran",
          "Apersepsi — Guru menyampaikan kompetensi yang akan dicapai peserta didik",
          "Apersepsi — Guru mengaitkan materi dengan materi pembelajaran sebelumnya",
          "Apersepsi — Guru mendemonstrasikan sesuatu yang terkait dengan materi pembelajaran"
        ]
      },
      {
        "code": "B",
        "title": "Kegiatan Inti",
        "indicators": [
          "Penguasaan materi pembelajaran — Guru menyesuaikan materi dengan tujuan pembelajaran.",
          "Penguasaan materi pembelajaran — Guru mengkaitkan materi dengan pengetahuan lain yang relevan, perkembangan iptek dan kehidupan nyata",
          "Penguasaan materi pembelajaran — Guru menyajikan pembahasan materi pembelajaran dengan tepat.",
          "Penguasaan materi pembelajaran — Guru menyajikan materi secara sistematis (mudah ke sulit, dari konkrit ke abstrak)",
          "Penerapan strategi pembelajaran yang mendidik — Guru melaksanakan pembelajaran sesuai dengan kompetensi yang akan dicapai.",
          "Penerapan strategi pembelajaran yang mendidik — Guru melaksanakan pembelajaran yang menumbuhkan partisipasi aktif peserta didik dalam mengajukan pertanyaan",
          "Penerapan strategi pembelajaran yang mendidik — Guru melaksanakan pembelajaran yang menumbuhkan partisipasi aktif peserta didik dalam mengemukakan pendapat",
          "Penerapan strategi pembelajaran yang mendidik — Guru melaksanakan pembelajaran yang mengembangkan keterampilan peserta didik sesuai dengan materi ajar",
          "Penerapan strategi pembelajaran yang mendidik — Guru melaksanakan pembelajaran yang bersifat kontekstual",
          "Penerapan strategi pembelajaran yang mendidik — Guru melaksanakan pembelajaran sesuai dengan alokasi waktu yang direncanakan",
          "Aktivitas Pembelajaran HOTS dan Kecakapan Abad 21 (4C) — Guru melaksanakan pembelajaran yang mengasah kemampuan Creativity peserta didik",
          "Aktivitas Pembelajaran HOTS dan Kecakapan Abad 21 (4C) — Guru melaksanakan pembelajaran yang mengasah kemampuan Critical Thinking peserta didik",
          "Aktivitas Pembelajaran HOTS dan Kecakapan Abad 21 (4C) — Guru melaksanakan pembelajaran yang mengasah kemampuan Communication peserta didik",
          "Aktivitas Pembelajaran HOTS dan Kecakapan Abad 21 (4C) — Guru melaksanakan pembelajaran yang mengasah kemampuan Collaboration peserta didik",
          "Kualitas pembelajaran: manajemen kelas — Terciptanya suasana kelas yang kondusif untuk proses belajar mengajar (tanpa disrupsi yang mengalihkan perhatian dari aktivitas belajar).",
          "Kualitas pembelajaran: manajemen kelas — Terlaksananya penerapan prinsip disiplin positif dalam menegakkan aturan kelas yang telah disepakati bersama.",
          "Pemanfaatan sumber belajar/media pembelajaran — Guru menunjukkan keterampilan dalam penggunaan sumber belajar yang bervariasi.",
          "Pemanfaatan sumber belajar/media pembelajaran — Guru menunjukkan keterampilan dalam penggunaan media pembelajaran",
          "Pemanfaatan sumber belajar/media pembelajaran — Guru melibatkan peserta didik dalam pemanfaatan sumber belajar",
          "Pemanfaatan sumber belajar/media pembelajaran — Guru melibatkan peserta didik dalam pemanfaatan media pembelajaran",
          "Pemanfaatan sumber belajar/media pembelajaran — Menghasilkan kesan yang menarik",
          "Penggunaan Bahasa yang benar dan tepat dalam pembelajaran — Menggunakan bahasa lisan secara jelas dan lancar",
          "Penggunaan Bahasa yang benar dan tepat dalam pembelajaran — Menggunakan bahasa tulis yang baik dan benar"
        ]
      },
      {
        "code": "C",
        "title": "Kegiatan Penutup",
        "indicators": [
          "Proses rangkuman, refleksi, dan tindak lanjut — Guru memfasilitasi dan membimbing peserta didik merangkum materi pelajaran.",
          "Proses rangkuman, refleksi, dan tindak lanjut — Guru menunjukkan aktivitas belajar yang bertujuan meningkatkan pengetahuan dan keterampilan mengajar.",
          "Proses rangkuman, refleksi, dan tindak lanjut — Guru menunjukkan aktivitas untuk mengevaluasi dan merefleksikan praktik pengajaran yang telah diterapkan, terutama dari sisi dampaknya terhadap belajar murid.",
          "Proses rangkuman, refleksi, dan tindak lanjut — Terlaksananya penerapan cara, bahan, dan/atau pendekatan baru dalam praktik pengajaran, mulai dari perencanaan, pelaksanaan, sampai evaluasi pembelajaran.",
          "Proses rangkuman, refleksi, dan tindak lanjut — Guru melaksanakan tindak lanjut dengan memberikan arahan kegiatan berikutnya dan tugas perbaikan dan pengayaan secara individu atau kelompok.",
          "Pelaksanaan Penilaian Hasil Belajar — Guru melaksanakan Penilaian Sikap melalui observasi",
          "Pelaksanaan Penilaian Hasil Belajar — Guru melaksanakan Penilaian Pengetahuan melalui tes lisan, tulisan",
          "Pelaksanaan Penilaian Hasil Belajar — Guru melaksanakan Penilaian Keterampilan; penilaian kinerja, projek, produk atau portofolio"
        ]
      }
    ],
    "pra_questions": [],
    "pasca_questions": [
      "Apa tanggapan dan refleksi Anda atas hasil supervisi ini?"
    ],
    "rtl_items": [
      "Catatan",
      "Tindak Lanjut"
    ],
    "predicates": [
      {
        "min": 91,
        "max": 100,
        "label": "Sangat Baik"
      },
      {
        "min": 81,
        "max": 90,
        "label": "Baik"
      },
      {
        "min": 71,
        "max": 80,
        "label": "Cukup"
      },
      {
        "min": 0,
        "max": 70,
        "label": "Kurang"
      }
    ]
  }
];
