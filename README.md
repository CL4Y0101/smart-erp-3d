# Smart ERP 3D

Simulasi lantai pabrik 3D interaktif buat demo Smart ERP — tim PLAY IT! PLUS 2026.

Dibangun pakai Next.js + Three.js.

Demo: https://smart-erp-3d.vercel.app

## Jalanin lokal

```bash
npm install
npm run dev
```

buka http://localhost:3000

## Isinya

- 6 stasiun: Pemotongan → Pengelasan → Perakitan → Pengecatan → Inspeksi QC → Pengemasan
- barang ngalir animasi di conveyor, tiap stasiun ada antreannya
- bottleneck kedeteksi otomatis dari beban & utilisasi, ditandain ring merah berdenyut
- panel what-if: geser kapasitas tiap stasiun, ubah permintaan pasar, atau pilih skenario (lonjakan permintaan / mesin melambat)
- rekomendasi AI: saran upgrade paling worth it + estimasi biaya, throughput baru, sama payback — tinggal klik terapin
- panel kanan: throughput, WIP, antrean, grafik, log kejadian

## Kontrol

- drag buat muter kamera, scroll buat zoom, klik mesin buat fokus
- play/pause + kecepatan 1x / 2x / 4x
- preset kamera: isometrik, atas, samping, fokus bottleneck, putar otomatis

## Struktur

- `app/` — halaman & layout Next.js
- `components/FactorySimulation.jsx` — komponen client yang jalanin simulasi
- `lib/simulation.js` — logika simulasi + Three.js
- `lib/simHtml.js` — markup panel UI
