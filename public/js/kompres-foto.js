/**
 * Kompresi foto bukti di klien (pola GezyAsko) — Fase 2.
 *
 * Sebelum form diunggah, berkas dikompresi lewat canvas menjadi JPEG:
 * sisi terpanjang maks 1600px, kualitas diturunkan bertahap sampai
 * ukuran <= 5 MB (batas server). Bila kompresi gagal, berkas asli tetap
 * dikirim dan server yang menolak bila melebihi 5 MB.
 */
(function () {
  const MAX_BYTES = 5 * 1024 * 1024;
  const MAX_SIDE = 1600;

  function compress(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        let { width, height } = img;
        const scale = Math.min(1, MAX_SIDE / Math.max(width, height));
        width = Math.round(width * scale);
        height = Math.round(height * scale);
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        canvas.getContext("2d").drawImage(img, 0, 0, width, height);
        let quality = 0.9;
        const attempt = () => {
          canvas.toBlob(
            (blob) => {
              if (!blob) return reject(new Error("Kompresi gagal."));
              if (blob.size > MAX_BYTES && quality > 0.4) {
                quality -= 0.15;
                attempt();
                return;
              }
              resolve(new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" }));
            },
            "image/jpeg",
            quality,
          );
        };
        attempt();
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("Berkas bukan gambar yang bisa dibaca."));
      };
      img.src = url;
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll('form[action$="/foto"]').forEach((form) => {
      const input = form.querySelector('input[type="file"][name="foto"]');
      if (!input) return;
      const info = document.createElement("p");
      info.className = "text-xs text-slate-500";
      input.after(info);
      input.addEventListener("change", () => {
        const file = input.files && input.files[0];
        if (!file) {
          info.textContent = "";
          return;
        }
        info.textContent = `Dipilih: ${(file.size / 1024 / 1024).toFixed(2)} MB — akan dikompresi otomatis bila perlu.`;
      });
      form.addEventListener("submit", async (ev) => {
        const file = input.files && input.files[0];
        if (!file) return;
        if (!file.type.startsWith("image/")) return; // biarkan server menolak mime salah
        if (file.size <= MAX_BYTES && file.type === "image/jpeg") return; // sudah cukup kecil
        ev.preventDefault();
        const btn = form.querySelector('button[type="submit"], button:not([type])');
        if (btn) {
          btn.disabled = true;
          btn.textContent = "Mengompresi foto…";
        }
        try {
          const compressed = await compress(file);
          const dt = new DataTransfer();
          dt.items.add(compressed);
          input.files = dt.files;
          info.textContent = `Terkompresi menjadi ${(compressed.size / 1024 / 1024).toFixed(2)} MB. Mengunggah…`;
          form.submit();
        } catch (err) {
          // Gagal kompres → kirim asli; server menolak bila > 5 MB.
          form.submit();
        }
      });
    });
  });
})();
