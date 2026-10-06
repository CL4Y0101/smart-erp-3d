export const SIM_HTML = `

    <div id="app">
      <!-- ============ LEFT: CONTROLS ============ -->
      <aside id="panel-left" aria-label="Kontrol simulasi">
        <h1 class="p-title">Kontrol Simulasi</h1>
        <p class="p-sub">Lini produksi roti 6 stasiun. Ubah kapasitas atau permintaan, lalu lihat bottleneck-nya berpindah sendiri.</p>

        <div class="row-btns">
          <button class="btn primary" id="btn-play" aria-pressed="true">
            <svg id="ic-pause" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>
            <svg id="ic-play" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" style="display:none"><path d="M8 5.5v13l11-6.5z"/></svg>
            <span id="play-lbl">Jeda</span>
          </button>
          <button class="btn" id="btn-reset">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/></svg>
            Reset
          </button>
        </div>
        <div class="ctl-line">
          <span class="lbl">Kecepatan simulasi</span>
          <div class="seg" id="seg-speed" role="group" aria-label="Kecepatan">
            <button data-v="1">1×</button>
            <button data-v="2" class="on">2×</button>
            <button data-v="4">4×</button>
          </div>
        </div>

        <h2 class="sect">Permintaan Pasar</h2>
        <div class="slider-block">
          <div class="slider-head">
            <label for="in-demand">Laju pesanan masuk</label>
            <span class="val"><b id="demand-val">9</b> unit/mnt</span>
          </div>
          <input type="range" id="in-demand" min="4" max="18" step="0.5" value="9" />
          <div class="slider-note">Kalau permintaan melewati kapasitas stasiun terlambat, antrean menumpuk di depannya.</div>
        </div>

        <h2 class="sect">Skenario</h2>
        <div class="scen-grid">
          <button class="scen on" data-scen="normal"><b>Normal</b><span>Permintaan stabil 9 unit/mnt</span></button>
          <button class="scen" data-scen="surge"><b>Lonjakan Permintaan</b><span>Pesanan naik ke 15 unit/mnt</span></button>
          <button class="scen" data-scen="slow"><b>Mesin Melambat</b><span>Satu mesin acak turun 45% kapasitas</span></button>
          <button class="scen" data-scen="recover"><b>Pulihkan Semua</b><span>Mesin kembali ke kapasitas slider</span></button>
        </div>

        <h2 class="sect">Kapasitas Stasiun · What-If</h2>
        <div id="station-sliders"></div>

        <h2 class="sect">Rekomendasi</h2>
        <div class="rec" id="rec-card">
          <h3>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18h6"/><path d="M10 21h4"/><path d="M12 3a6 6 0 0 0-4 10.5c.8.7 1 1.5 1 2.5h6c0-1 .2-1.8 1-2.5A6 6 0 0 0 12 3z"/></svg>
            Rekomendasi AI
          </h3>
          <p id="rec-text">Menghitung dari antrean &amp; utilisasi…</p>
          <div class="nums" id="rec-nums"></div>
          <button class="btn primary" id="btn-apply" style="width:100%;justify-content:center">Terapkan Rekomendasi</button>
          <p class="assump">Estimasi kasar dari model simulasi: biaya upgrade Rp18 jt per +1 unit/mnt kapasitas · margin Rp3.500/unit · 160 jam kerja/bulan.</p>
        </div>
      </aside>

      <!-- ============ CENTER: 3D ============ -->
      <div id="scene-wrap">
        <canvas id="scene"></canvas>
        <div class="vignette"></div>
        <div id="nogl"><p>WebGL / Three.js tidak termuat, jadi lantai 3D tidak tampil.<br />Panel kontrol &amp; statistik di samping tetap menjalankan simulasinya.</p></div>
        <div class="hud tl">
          <span class="chip st-ok" id="chip-status"><span class="dotg"></span><span id="status-txt">Berjalan</span>&nbsp;·&nbsp;<span class="mono" id="clock">08:00</span>&nbsp;·&nbsp;<span class="mono" id="elapsed">+0 mnt</span></span>
          <span class="chip bn" id="chip-bn"><span class="pulse"></span><span id="bn-txt">Bottleneck: —</span></span>
        </div>
        <div class="hud bl">
          <div class="cam-btns" role="group" aria-label="Kamera">
            <button data-cam="iso" class="on">Isometrik</button>
            <button data-cam="top">Atas</button>
            <button data-cam="side">Samping</button>
            <button data-cam="focus">Fokus Bottleneck</button>
            <button data-cam="orbit" id="btn-orbit">Putar Otomatis</button>
          </div>
        </div>
        <div class="hud br">
          <span class="chip legend">
            <span><i style="background:var(--ok)"></i>Proses</span>
            <span><i style="background:var(--warn)"></i>Menunggu</span>
            <span><i style="background:var(--danger)"></i>Bottleneck</span>
          </span>
        </div>
        <div class="hint">Seret untuk memutar · scroll untuk zoom · klik mesin untuk fokus</div>
      </div>

      <!-- ============ RIGHT: STATS ============ -->
      <aside id="panel-right" aria-label="Statistik produksi">
        <h2 class="p-title">Hasil Produksi</h2>
        <p class="p-sub">Angka bergerak mengikuti simulasi yang sedang berjalan.</p>
        <div class="stat-grid">
          <div class="stat"><i>Unit Selesai</i><b id="st-done">0</b></div>
          <div class="stat"><i>Throughput</i><b id="st-tput">0</b> <small>unit/jam</small></div>
          <div class="stat"><i>Sedang Diproses (WIP)</i><b id="st-wip">0</b></div>
          <div class="stat"><i>Total Antrean</i><b id="st-queue">0</b></div>
        </div>

        <h2 class="sect">Throughput per Jam</h2>
        <canvas id="chart" width="560" height="192" aria-label="Grafik throughput"></canvas>

        <h2 class="sect">Status Stasiun</h2>
        <div id="station-rows"></div>

        <h2 class="sect">Log Kejadian</h2>
        <ul id="log"></ul>
      </aside>
    </div>
    <noscript><p style="padding:16px">Simulasi ini membutuhkan JavaScript.</p></noscript>

  `;
