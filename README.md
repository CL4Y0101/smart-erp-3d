# Smart ERP 3D

Simulasi lantai pabrik 3D interaktif buat demo Smart ERP — tim PLAY IT! PLUS 2026.

Satu file HTML, langsung buka di browser. Dibangun pakai Three.js (di-bundle lokal, ga perlu internet buat library-nya).

## Cara jalanin

Buka `index.html` di browser. Atau buka link demo:

Demo: (link Vercel nyusul)

## Isinya

- 6 stasiun produksi: Pemotongan → Pengelasan → Perakitan → Pengecatan → Inspeksi QC → Pengemasan
- Alur barang animasi + antrean per stasiun
- Bottleneck kedeteksi otomatis dari beban & utilisasi, ditandain ring merah berdenyut
- Panel what-if: geser kapasitas tiap stasiun, coba skenario lonjakan permintaan / mesin melambat
- Rekomendasi AI: saran upgrade lengkap sama estimasi biaya & payback, bisa langsung diterapkan ke simulasi

## Kontrol

- Drag buat muter kamera, scroll buat zoom, klik mesin buat fokus
- Play/pause + kecepatan simulasi 1x / 2x / 4x
- Preset kamera: Isometrik, Atas, Samping, Fokus Bottleneck, Putar Otomatis
