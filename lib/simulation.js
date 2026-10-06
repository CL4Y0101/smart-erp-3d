import * as THREE from 'three';

export function initSimulation(){
  var fallbackTimer = null;

      'use strict';

      /* ================= SIMULATION CORE ================= */
      var ST_DEF = [
        { name:'Pemotongan',  rate:14, color:0x38bdf8, css:'#38bdf8' },
        { name:'Pengelasan',  rate:12, color:0x2dd4bf, css:'#2dd4bf' },
        { name:'Perakitan',   rate:11, color:0xa3e635, css:'#a3e635' },
        { name:'Pengecatan',  rate:8,  color:0xffb02e, css:'#ffb02e' },
        { name:'Inspeksi QC', rate:10, color:0xfb923c, css:'#fb923c' },
        { name:'Pengemasan',  rate:13, color:0x4ade80, css:'#4ade80' }
      ];
      var N = ST_DEF.length;
      var SX = []; for (var i=0;i<N;i++) SX.push(-15 + i*6);

      var stations, items, completions, samples;
      var simMin, running, speedMul, demand, spawnTimer;
      var bottleneckIdx, bnCandidate, bnCandTime, lastBnCheck, lastSample;
      var finishedStack, itemSeq, wipFullLogged;
      var currentRec = null;
      var scenState = 'normal';

      function effRate(i){ return stations[i].rate * stations[i].slow; }
      function resetSim(){
        if (window.__clearMeshes) window.__clearMeshes();
        stations = ST_DEF.map(function(d){
          return { name:d.name, rate:d.rate, queue:[], current:null, prog:0,
                   dur:1, util:0, slow:1, slowUntil:-1 };
        });
        items = []; completions = []; samples = [];
        finishedStack = [];
        simMin = 0; spawnTimer = 0.4; itemSeq = 0; wipFullLogged = false;
        bottleneckIdx = -1; bnCandidate = -1; bnCandTime = 0;
        lastBnCheck = 0; lastSample = 0; totalDone = 0;
        logEvent('Simulasi dimulai — permintaan ' + fmt(demand) + ' unit/mnt.', false);
      }

      function createItem(){
        var it = { id:++itemSeq, st:0, state:'queue', mesh:null, snap:true, stackIdx:-1 };
        stations[0].queue.push(it);
        items.push(it);
        if (window.__makeCrate) window.__makeCrate(it);
        return it;
      }
      function removeItem(it){
        var k = items.indexOf(it); if (k>=0) items.splice(k,1);
        if (window.__dropCrate) window.__dropCrate(it);
      }

      /* substep so coarse dt (warm-up, fallback timer) stays accurate */
      function stepSim(dt){
        var n = Math.max(1, Math.ceil(dt/0.005));
        var h = dt/n;
        for (var k=0;k<n;k++) stepOnce(h);
      }
      function stepOnce(dt){
        simMin += dt;
        /* source */
        spawnTimer -= dt;
        var interval = 1/Math.max(demand,0.1);
        var guard = 0;
        while (spawnTimer <= 0 && guard++ < 40){
          spawnTimer += interval;
          if (items.length < 110){ createItem(); }
          else if (!wipFullLogged){ wipFullLogged = true; logEvent('WIP penuh (110 unit) — pesanan baru tertahan di pintu masuk.', true); }
        }
        if (items.length < 100) wipFullLogged = false;

        /* stations */
        for (var i=0;i<N;i++){
          var s = stations[i];
          if (s.slow < 1 && s.slowUntil > 0 && simMin >= s.slowUntil){
            s.slow = 1; s.slowUntil = -1;
            logEvent('Mesin <b>' + s.name + '</b> selesai diperbaiki, kapasitas pulih.', false);
            refreshSlowTags();
          }
          if (!s.current && s.queue.length){
            s.current = s.queue.shift();
            s.current.state = 'process';
            s.prog = 0;
            s.dur = 1/Math.max(effRate(i),0.1);
          }
          if (s.current){
            s.prog += dt/s.dur;
            if (s.prog >= 1){
              var done = s.current; s.current = null; s.prog = 0;
              if (i === N-1){
                completions.push(simMin); totalDone++;
                done.state = 'stack';
                done.stackIdx = finishedStack.length;
                finishedStack.push(done);
                if (finishedStack.length > 36){
                  var old = finishedStack.shift();
                  removeItem(old);
                  finishedStack.forEach(function(x,ix){ x.stackIdx = ix; });
                }
              } else {
                done.st = i+1; done.state = 'queue';
                stations[i+1].queue.push(done);
              }
            }
          }
          s.util += (((s.current)?1:0) - s.util) * (1 - Math.exp(-dt/4));
        }
        /* prune completion window */
        while (completions.length && completions[0] < simMin - 65) completions.shift();

        /* bottleneck check */
        if (simMin - lastBnCheck >= 0.5){
          lastBnCheck = simMin;
          detectBottleneck();
        }
        /* throughput samples */
        if (simMin - lastSample >= 2){
          lastSample = simMin;
          var c = 0;
          for (var j=completions.length-1;j>=0;j--){ if (completions[j] > simMin-2) c++; else break; }
          samples.push(c*30);
          if (samples.length > 42) samples.shift();
          drawChart();
        }
      }

      function bnScore(i){
        /* constraint score: load = inflow vs capacity (TOC), queue & utilisation as evidence */
        var inflow = demand;
        for (var j=0;j<i;j++) inflow = Math.min(inflow, effRate(j));
        var load = inflow / Math.max(effRate(i), 0.1);
        var s = stations[i];
        return load*10 + s.util*0.5 + Math.min(s.queue.length, 10)*0.02 + i*0.01;
      }
      function detectBottleneck(){
        var best = 0, bs = -1;
        for (var i=0;i<N;i++){ var sc = bnScore(i); if (sc > bs){ bs = sc; best = i; } }
        if (bottleneckIdx === -1){
          bottleneckIdx = best;
          onBottleneckChanged(best, true);
          return;
        }
        if (best !== bottleneckIdx){
          if (best === bnCandidate) bnCandTime += 0.5; else { bnCandidate = best; bnCandTime = 0; }
          if (bnCandTime >= 1.5){
            bottleneckIdx = best; bnCandidate = -1; bnCandTime = 0;
            onBottleneckChanged(best, false);
          }
        } else { bnCandidate = -1; bnCandTime = 0; }
      }
      function onBottleneckChanged(i, first){
        var s = stations[i];
        logEvent((first ? 'Bottleneck terdeteksi di <b>' : 'Bottleneck berpindah ke <b>') + s.name +
                 '</b> — antrean ' + s.queue.length + ' unit, kapasitas ' + fmt(effRate(i)) + ' unit/mnt.', true);
        computeRec();
      }

      /* ================= RECOMMENDATION ================= */
      function throughputPerHour(){
        var c = 0;
        for (var j=completions.length-1;j>=0;j--){ if (completions[j] > simMin-10) c++; else break; }
        return c * 6; /* completions in trailing 10 min, scaled to an hourly rate */
      }
      function computeRec(){
        var card = document.getElementById('rec-card');
        var txt = document.getElementById('rec-text');
        var nums = document.getElementById('rec-nums');
        var btn = document.getElementById('btn-apply');
        if (bottleneckIdx < 0){ txt.textContent = 'Menunggu data antrean…'; btn.disabled = true; return; }
        var b = bottleneckIdx, s = stations[b];
        var rates = stations.map(function(x,ix){ return effRate(ix); });
        var minRate = Math.min.apply(null, rates);
        var measured = throughputPerHour();
        var T = measured > 0 ? measured/60 : Math.min(demand, minRate);
        var others = rates.filter(function(_,ix){ return ix !== b; });
        var nextRate = Math.min.apply(null, others);
        var target = Math.min(Math.max(nextRate, Math.min(demand, nextRate)), rates[b]*1.6);
        /* aim just past the next constraint so the bottleneck visibly relocates */
        target = Math.min(Math.max(target, Math.min(nextRate + 1, Math.max(demand * 1.25, rates[b] + 1))), rates[b]*1.6);
        var delta = Math.max(0, Math.ceil(target - s.rate));
        var capped = (s.rate + delta) > 20;
        if (capped) delta = 20 - s.rate;
        /* never call it balanced while inflow still exceeds this station's capacity */
        var inflowB = demand;
        for (var ib=0; ib<b; ib++) inflowB = Math.min(inflowB, effRate(ib));
        if (delta <= 0 && rates[b] < inflowB) delta = Math.min(20 - s.rate, Math.ceil(inflowB - rates[b]));

        if (delta <= 0 || (s.queue.length <= 1 && rates[b] >= demand)){
          card.classList.add('balanced');
          txt.innerHTML = 'Lini relatif seimbang: kapasitas <b>' + s.name + '</b> (' + fmt(rates[b]) +
            ' unit/mnt) masih menampung permintaan ' + fmt(demand) + ' unit/mnt. Pantau antrean sebelum menambah kapasitas.';
          nums.innerHTML = '';
          btn.disabled = true; btn.textContent = 'Tidak Ada Tindakan Mendesak';
          currentRec = null;
          return;
        }
        card.classList.remove('balanced');
        var newRates = rates.slice(); newRates[b] = s.rate + delta;
        var proj = Math.min(demand, Math.min.apply(null, newRates));
        var gainPct = T > 0 ? Math.max(0,(proj - T)/T*100) : 0;
        var nextBn = -1, nextBnRate = Infinity;
        newRates.forEach(function(r, ix){ if (ix !== b && r < nextBnRate){ nextBnRate = r; nextBn = ix; } });
        var cost = delta * 18e6;
        var extraMonth = Math.max(0,(proj - T)) * 60 * 160 * 3500;
        var payback = extraMonth > 0 ? cost/extraMonth : Infinity;
        txt.innerHTML = 'Naikkan kapasitas <b>' + s.name + '</b> sebesar <b>+' + delta + ' unit/mnt</b> (' +
          fmt(s.rate) + ' → ' + fmt(s.rate+delta) + '). Throughput naik ≈ <b>' + fmt(gainPct) + '%</b>, dan bottleneck berikutnya diprediksi pindah ke <b>' +
          stations[nextBn].name + '</b>.';
        nums.innerHTML =
          '<div class="num"><i>Biaya upgrade</i><b>' + moneyShort(cost) + '</b></div>' +
          '<div class="num"><i>Throughput baru</i><b>≈ ' + fmt(proj*60) + '/jam</b></div>' +
          '<div class="num"><i>Payback</i><b>' + (isFinite(payback) ? fmt(Math.max(payback,0.1)) + ' bln' : '—') + '</b></div>';
        btn.disabled = false; btn.textContent = 'Terapkan: ' + s.name + ' +' + delta + ' unit/mnt';
        currentRec = { station:b, delta:delta };
      }

      /* ================= FORMAT ================= */
      function fmt(n){
        return Number(n).toLocaleString('id-ID', { maximumFractionDigits: (Math.abs(n)%1>0.001?1:0) });
      }
      function moneyShort(n){
        if (n >= 1e9) return 'Rp ' + fmt(n/1e9) + ' M';
        if (n >= 1e6) return 'Rp ' + fmt(n/1e6) + ' jt';
        return 'Rp ' + fmt(n);
      }
      function clockStr(){
        var t = 480 + Math.floor(simMin);
        var hh = Math.floor(t/60) % 24, mm = t % 60;
        return (hh<10?'0':'') + hh + ':' + (mm<10?'0':'') + mm;
      }

      /* ================= LOG ================= */
      var logEl = document.getElementById('log');
      function logEvent(html, alert){
        var li = document.createElement('li');
        if (alert) li.className = 'alert';
        li.innerHTML = '<span class="t">' + clockStr() + '</span><span>' + html + '</span>';
        logEl.insertBefore(li, logEl.firstChild);
        while (logEl.children.length > 9) logEl.removeChild(logEl.lastChild);
      }

      /* ================= UI BUILD ================= */
      var slidersWrap = document.getElementById('station-sliders');
      var rowsWrap = document.getElementById('station-rows');
      var sliderEls = [], rowEls = [];

      ST_DEF.forEach(function(d, i){
        var box = document.createElement('div');
        box.className = 'st-slider'; box.id = 'sl-box-' + i;
        box.innerHTML =
          '<div class="slider-head"><label for="sl-' + i + '"><span class="dot" style="background:' + d.css + '"></span>' +
          d.name + '<span class="slow-tag" id="slow-' + i + '" style="display:none">MELAMBAT</span></label>' +
          '<span class="val"><b id="slv-' + i + '">' + d.rate + '</b> unit/mnt</span></div>' +
          '<input type="range" id="sl-' + i + '" min="4" max="20" step="1" value="' + d.rate + '" aria-label="Kapasitas ' + d.name + '" />';
        slidersWrap.appendChild(box);
        var inp = box.querySelector('input');
        inp.addEventListener('input', function(){
          stations[i].rate = parseFloat(inp.value);
          document.getElementById('slv-' + i).textContent = inp.value;
          computeRec();
        });
        sliderEls.push(inp);

        var row = document.createElement('div');
        row.className = 'st-row'; row.id = 'row-' + i;
        row.innerHTML =
          '<div class="top"><span class="nm">' + d.name + '</span><span class="bn-tag">BOTTLENECK</span>' +
          '<span class="rt" id="row-rt-' + i + '"></span></div>' +
          '<div class="bar"><i id="row-bar-' + i + '"></i></div>' +
          '<div class="meta"><span>Utilisasi <b id="row-u-' + i + '">0%</b></span><span>Antrean <b id="row-q-' + i + '">0</b></span></div>';
        rowsWrap.appendChild(row);
        rowEls.push(row);
      });

      function refreshSlowTags(){
        stations.forEach(function(s, i){
          document.getElementById('slow-' + i).style.display = s.slow < 1 ? '' : 'none';
          document.getElementById('sl-box-' + i).classList.toggle('slowed', s.slow < 1);
        });
      }

      /* demand */
      var demandEl = document.getElementById('in-demand');
      demandEl.addEventListener('input', function(){
        demand = parseFloat(demandEl.value);
        document.getElementById('demand-val').textContent = fmt(demand);
        computeRec();
      });

      /* play / speed / reset */
      running = true; speedMul = 2; demand = 9;
      var btnPlay = document.getElementById('btn-play');
      function setRunning(v){
        running = v;
        document.getElementById('ic-pause').style.display = v ? '' : 'none';
        document.getElementById('ic-play').style.display = v ? 'none' : '';
        document.getElementById('play-lbl').textContent = v ? 'Jeda' : 'Jalankan';
        btnPlay.setAttribute('aria-pressed', v ? 'true' : 'false');
        var chip = document.getElementById('chip-status');
        chip.className = 'chip ' + (v ? 'st-ok' : 'st-pause');
        document.getElementById('status-txt').textContent = v ? 'Berjalan' : 'Jeda';
      }
      btnPlay.addEventListener('click', function(){ setRunning(!running); });
      document.getElementById('btn-reset').addEventListener('click', function(){
        resetSim(); refreshSlowTags(); computeRec(); drawChart();
        logEvent('Simulasi di-reset dari awal shift.', false);
      });
      document.getElementById('seg-speed').addEventListener('click', function(e){
        var b = e.target.closest('button'); if (!b) return;
        speedMul = parseFloat(b.dataset.v);
        this.querySelectorAll('button').forEach(function(x){ x.classList.toggle('on', x === b); });
      });

      /* scenarios */
      var scenBtns = document.querySelectorAll('.scen');
      function setScen(name){
        scenState = name;
        scenBtns.forEach(function(b){ b.classList.toggle('on', b.dataset.scen === name); });
      }
      scenBtns.forEach(function(b){
        b.addEventListener('click', function(){
          var k = b.dataset.scen;
          if (k === 'normal'){
            demand = 9; demandEl.value = 9;
            document.getElementById('demand-val').textContent = '9';
            setScen('normal'); logEvent('Skenario normal — permintaan stabil 9 unit/mnt.', false);
          } else if (k === 'surge'){
            demand = 15; demandEl.value = 15;
            document.getElementById('demand-val').textContent = '15';
            setScen('surge'); logEvent('Lonjakan permintaan! Pesanan naik ke 15 unit/mnt.', true);
          } else if (k === 'slow'){
            var pool = stations.map(function(_,ix){ return ix; }).filter(function(ix){
              return ix !== bottleneckIdx && stations[ix].slow >= 1;
            });
            if (!pool.length) pool = [0];
            var pick = pool[Math.floor(Math.random()*pool.length)];
            stations[pick].slow = 0.55; stations[pick].slowUntil = simMin + 45;
            refreshSlowTags(); setScen('slow');
            logEvent('Mesin <b>' + stations[pick].name + '</b> melambat (kapasitas −45%) selama ±45 mnt sim. Antrean mulai bergeser.', true);
          } else if (k === 'recover'){
            stations.forEach(function(s){ s.slow = 1; s.slowUntil = -1; });
            refreshSlowTags(); setScen('normal');
            logEvent('Semua mesin pulih ke kapasitas normal.', false);
          }
          computeRec();
        });
      });

      /* apply recommendation */
      document.getElementById('btn-apply').addEventListener('click', function(){
        if (!currentRec) return;
        var i = currentRec.station;
        stations[i].rate = Math.min(20, stations[i].rate + currentRec.delta);
        sliderEls[i].value = stations[i].rate;
        document.getElementById('slv-' + i).textContent = stations[i].rate;
        var box = document.getElementById('sl-box-' + i);
        box.classList.add('flash'); setTimeout(function(){ box.classList.remove('flash'); }, 1200);
        logEvent('Rekomendasi diterapkan: kapasitas <b>' + stations[i].name + '</b> naik ke ' +
                 fmt(stations[i].rate) + ' unit/mnt. Pantau bottleneck berikutnya.', false);
        computeRec();
      });

      /* ================= CHART ================= */
      var chart = document.getElementById('chart');
      var cx2 = chart.getContext('2d');
      function drawChart(){
        var w = chart.width, h = chart.height;
        var isLight = window.matchMedia('(prefers-color-scheme: light)').matches;
        cx2.clearRect(0,0,w,h);
        var grid = isLight ? 'rgba(21,34,47,.10)' : 'rgba(233,239,246,.08)';
        var line = isLight ? '#0d9488' : '#2dd4bf';
        var txtC = isLight ? 'rgba(21,34,47,.55)' : 'rgba(233,239,246,.5)';
        cx2.strokeStyle = grid; cx2.lineWidth = 1;
        for (var g=1; g<=3; g++){ var y = h*g/4; cx2.beginPath(); cx2.moveTo(34,y); cx2.lineTo(w-8,y); cx2.stroke(); }
        if (samples.length < 2){
          cx2.fillStyle = txtC; cx2.font = '22px "IBM Plex Mono", monospace';
          cx2.fillText('mengumpulkan data…', 40, h/2 + 8);
          return;
        }
        var max = Math.max.apply(null, samples.concat([demand*60])) * 1.15;
        function X(k){ return 34 + (w-46) * k/(41); }
        function Y(v){ return h - 14 - (h-34) * v/max; }
        cx2.fillStyle = txtC; cx2.font = '19px "IBM Plex Mono", monospace';
        cx2.fillText(fmt(max/1.15) + '', 2, 22);
        cx2.fillText('0', 16, h - 12);
        /* demand line */
        cx2.strokeStyle = isLight ? 'rgba(217,119,6,.75)' : 'rgba(255,176,46,.6)';
        cx2.setLineDash([6,5]); cx2.beginPath();
        cx2.moveTo(34, Y(demand*60)); cx2.lineTo(w-8, Y(demand*60)); cx2.stroke(); cx2.setLineDash([]);
        /* area + line */
        cx2.beginPath();
        samples.forEach(function(v,k){ var x = X(k + (42 - samples.length)), y = Y(v); if (k===0) cx2.moveTo(x,y); else cx2.lineTo(x,y); });
        cx2.strokeStyle = line; cx2.lineWidth = 2.5; cx2.stroke();
        cx2.lineTo(X(41), h-14); cx2.lineTo(X(42 - samples.length), h-14); cx2.closePath();
        cx2.fillStyle = isLight ? 'rgba(13,148,136,.14)' : 'rgba(45,212,191,.13)'; cx2.fill();
        var lv = samples[samples.length-1];
        cx2.beginPath(); cx2.arc(X(41), Y(lv), 4.5, 0, 7); cx2.fillStyle = line; cx2.fill();
      }

      /* ================= HUD ================= */
      var elDone = document.getElementById('st-done'), elTput = document.getElementById('st-tput'),
          elWip = document.getElementById('st-wip'), elQueue = document.getElementById('st-queue'),
          elClock = document.getElementById('clock'), elBn = document.getElementById('bn-txt'),
          elElapsed = document.getElementById('elapsed');
      var totalDone = 0;
      function updateHUD(){
        elClock.textContent = clockStr();
        elElapsed.textContent = '+' + Math.floor(simMin) + ' mnt';
        var tq = 0;
        stations.forEach(function(s,i){
          tq += s.queue.length;
          document.getElementById('row-rt-' + i).textContent = fmt(effRate(i)) + ' unit/mnt';
          document.getElementById('row-u-' + i).textContent = Math.round(s.util*100) + '%';
          document.getElementById('row-q-' + i).textContent = s.queue.length;
          document.getElementById('row-bar-' + i).style.width = Math.min(100, s.util*100) + '%';
          rowEls[i].classList.toggle('is-bn', i === bottleneckIdx);
        });
        elDone.textContent = fmt(totalDone);
        elTput.textContent = fmt(throughputPerHour());
        elWip.textContent = fmt(items.length - finishedStack.length);
        elQueue.textContent = fmt(tq);
        if (bottleneckIdx >= 0){
          var b = stations[bottleneckIdx];
          elBn.textContent = 'Bottleneck: ' + b.name + ' · antre ' + b.queue.length + ' · ' + fmt(effRate(bottleneckIdx)) + ' unit/mnt';
        }
      }

      /* ================= BOOT (sim) ================= */
      resetSim();
      /* warm-up: run 26 sim-min so queues & bottleneck already tell a story on load */
      for (var wu=0; wu<260; wu++) stepSim(0.1);
      computeRec(); updateHUD(); drawChart();

      /* ================= THREE.JS SCENE ================= */
      var REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      var LIGHT = window.matchMedia('(prefers-color-scheme: light)').matches;
      var threeOK = (typeof THREE !== 'undefined');
      if (!threeOK) document.body.classList.add('no-webgl');

      var renderer, scene, camera, machineGroups = [], lampMats = [], labelObjs = [],
          hitBoxes = [], marker, markerLight, badge, particles, particleData, beltTex;
      var crateMats = {};
      var sph = { theta: 0.85, phi: 1.02, r: 35 };
      var camTarget = null, camAnim = null, autoOrbit = false;
      var targetVec = null;

      function crateTarget(it, out){
        if (it.state === 'stack'){
          var idx = it.stackIdx < 0 ? 0 : it.stackIdx;
          var col = idx % 4, row = Math.floor(idx/4) % 3, layer = Math.floor(idx/12);
          out.set(20.4 + col*0.58, 0.86 + layer*0.5, -0.9 + row*0.62);
        } else if (it.state === 'process'){
          var s = stations[it.st];
          out.set(SX[it.st] + (s.prog - 0.5) * 1.25, 0.86, 0);
        } else {
          var qi = stations[it.st].queue.indexOf(it);
          if (qi < 0) qi = 0;
          var lane = Math.floor(qi/6) % 2, colq = qi % 6, layerq = Math.floor(qi/12);
          out.set(SX[it.st] - 2.05 - colq*0.54, 0.86 + layerq*0.5, lane === 0 ? -0.33 : 0.33);
        }
        return out;
      }

      if (threeOK){
        var wrap = document.getElementById('scene-wrap');
        var canvas = document.getElementById('scene');
        renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        renderer.outputEncoding = THREE.sRGBEncoding;
        scene = new THREE.Scene();
        scene.background = new THREE.Color(LIGHT ? 0xd7e2ec : 0x0d141d);
        scene.fog = new THREE.Fog(LIGHT ? 0xd7e2ec : 0x0d141d, 55, 110);
        camera = new THREE.PerspectiveCamera(46, 1, 0.1, 300);
        targetVec = new THREE.Vector3(1.2, 0.7, 0);

        /* lights */
        scene.add(new THREE.HemisphereLight(LIGHT ? 0xffffff : 0xbfd4e6, LIGHT ? 0x8fa3b5 : 0x1c2733, LIGHT ? 0.95 : 0.75));
        var sun = new THREE.DirectionalLight(0xffffff, LIGHT ? 0.85 : 0.95);
        sun.position.set(18, 30, 14);
        sun.castShadow = true;
        sun.shadow.mapSize.set(2048, 2048);
        sun.shadow.camera.left = -30; sun.shadow.camera.right = 30;
        sun.shadow.camera.top = 22; sun.shadow.camera.bottom = -22;
        sun.shadow.camera.far = 80; sun.shadow.bias = -0.0006;
        scene.add(sun);
        var fill = new THREE.DirectionalLight(0xaac4de, 0.3);
        fill.position.set(-20, 14, -18); scene.add(fill);

        /* ---- floor ---- */
        function floorTexture(){
          var c = document.createElement('canvas'); c.width = c.height = 512;
          var g = c.getContext('2d');
          g.fillStyle = LIGHT ? '#c3d0dc' : '#232d38'; g.fillRect(0,0,512,512);
          g.strokeStyle = LIGHT ? 'rgba(40,60,80,.16)' : 'rgba(255,255,255,.055)';
          g.lineWidth = 2;
          for (var k=0;k<=512;k+=128){ g.beginPath(); g.moveTo(k,0); g.lineTo(k,512); g.stroke(); g.beginPath(); g.moveTo(0,k); g.lineTo(512,k); g.stroke(); }
          g.fillStyle = LIGHT ? 'rgba(40,60,80,.05)' : 'rgba(255,255,255,.03)';
          for (var a=0;a<40;a++) g.fillRect(Math.random()*512, Math.random()*512, 3, 3);
          var t = new THREE.CanvasTexture(c);
          t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(9,6);
          return t;
        }
        var floor = new THREE.Mesh(
          new THREE.PlaneGeometry(110, 72),
          new THREE.MeshStandardMaterial({ map: floorTexture(), roughness: .95, metalness: 0 })
        );
        floor.rotation.x = -Math.PI/2; floor.receiveShadow = true;
        scene.add(floor);

        /* safety lines along conveyor */
        var lineMat = new THREE.MeshBasicMaterial({ color: 0xd8a012 });
        [-1.65, 1.65].forEach(function(z){
          var strip = new THREE.Mesh(new THREE.BoxGeometry(41, 0.012, 0.14), lineMat);
          strip.position.set(-0.5, 0.012, z); scene.add(strip);
        });

        /* ---- back wall + pillars + light bars ---- */
        function wallTexture(){
          var c = document.createElement('canvas'); c.width = 1024; c.height = 256;
          var g = c.getContext('2d');
          g.fillStyle = LIGHT ? '#b9c9d8' : '#1a2531'; g.fillRect(0,0,1024,256);
          g.fillStyle = LIGHT ? 'rgba(90,140,180,.5)' : 'rgba(110,170,220,.16)';
          for (var x=24;x<1000;x+=96) g.fillRect(x, 36, 64, 74);
          g.fillStyle = LIGHT ? 'rgba(40,60,80,.18)' : 'rgba(255,255,255,.05)';
          for (var x2=0;x2<=1024;x2+=128) g.fillRect(x2, 130, 2, 126);
          var t = new THREE.CanvasTexture(c);
          t.wrapS = THREE.RepeatWrapping; t.repeat.set(3,1);
          return t;
        }
        var wall = new THREE.Mesh(new THREE.PlaneGeometry(110, 13),
          new THREE.MeshStandardMaterial({ map: wallTexture(), roughness: .9 }));
        wall.position.set(0, 6.5, -11); scene.add(wall);
        var pillarMat = new THREE.MeshStandardMaterial({ color: LIGHT ? 0x9db2c4 : 0x2b3949, roughness: .8 });
        for (var px=-24; px<=24; px+=12){
          var p = new THREE.Mesh(new THREE.BoxGeometry(0.7, 13, 0.7), pillarMat);
          p.position.set(px, 6.5, -10.6); p.castShadow = true; scene.add(p);
        }
        var barMat = new THREE.MeshBasicMaterial({ color: LIGHT ? 0xf4f8ff : 0xdfeeff });
        for (var bx=-18; bx<=18; bx+=9){
          var bar = new THREE.Mesh(new THREE.BoxGeometry(5.5, 0.08, 0.5), barMat);
          bar.position.set(bx, 6.4, 0); scene.add(bar);
          var beam = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 8), pillarMat);
          beam.position.set(bx, 6.55, 0); scene.add(beam);
        }

        /* ---- conveyor ---- */
        function beltTexture(){
          var c = document.createElement('canvas'); c.width = 128; c.height = 128;
          var g = c.getContext('2d');
          g.fillStyle = '#151a20'; g.fillRect(0,0,128,128);
          g.strokeStyle = 'rgba(200,220,240,.20)'; g.lineWidth = 7;
          for (var k=-128;k<256;k+=42){
            g.beginPath(); g.moveTo(k, 138); g.lineTo(k+52, -10); g.stroke();
          }
          var t = new THREE.CanvasTexture(c);
          t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(16,1);
          return t;
        }
        beltTex = beltTexture();
        var belt = new THREE.Mesh(new THREE.BoxGeometry(41, 0.5, 1.7),
          new THREE.MeshStandardMaterial({ color: 0x39434e, roughness: .7, metalness: .35 }));
        belt.position.set(-0.5, 0.36, 0); belt.receiveShadow = true; scene.add(belt);
        var beltTop = new THREE.Mesh(new THREE.PlaneGeometry(41, 1.62),
          new THREE.MeshStandardMaterial({ map: beltTex, roughness: .85 }));
        beltTop.rotation.x = -Math.PI/2; beltTop.position.set(-0.5, 0.62, 0);
        beltTop.receiveShadow = true; scene.add(beltTop);
        var railMat = new THREE.MeshStandardMaterial({ color: 0x707c89, roughness: .4, metalness: .7 });
        [-0.92, 0.92].forEach(function(z){
          var rail = new THREE.Mesh(new THREE.BoxGeometry(41, 0.09, 0.07), railMat);
          rail.position.set(-0.5, 0.68, z); scene.add(rail);
        });

        /* ---- crates ---- */
        crateMats = {
          raw: new THREE.MeshStandardMaterial({ color: 0x9aa7b4, roughness: .8 }),
          painted: new THREE.MeshStandardMaterial({ color: 0x2f7fd0, roughness: .65 }),
          done: new THREE.MeshStandardMaterial({ color: 0x1fae8f, roughness: .65 })
        };
        var crateGeo = new THREE.BoxGeometry(0.44, 0.4, 0.44);
        var crateEdge = new THREE.EdgesGeometry(crateGeo);
        var edgeMat = new THREE.LineBasicMaterial({ color: 0x10161d, transparent: true, opacity: .35 });
        window.__makeCrate = function(it){
          var m = new THREE.Mesh(crateGeo, crateMats.raw);
          m.castShadow = true;
          m.add(new THREE.LineSegments(crateEdge, edgeMat));
          var t = crateTarget(it, new THREE.Vector3());
          m.position.set(-21.5, t.y, t.z);
          if (it.snap) { /* spawn always slides in from entry */ }
          scene.add(m);
          it.mesh = m;
        };
        window.__dropCrate = function(it){
          if (it.mesh){ scene.remove(it.mesh); it.mesh = null; }
        };
        window.__clearMeshes = function(){
          items.forEach(function(it){ if (it.mesh){ scene.remove(it.mesh); it.mesh = null; } });
        };

        /* ---- machines ---- */
        var bodyMat = new THREE.MeshStandardMaterial({ color: LIGHT ? 0x5b7186 : 0x2e3c4d, roughness: .55, metalness: .45 });
        var darkMat = new THREE.MeshStandardMaterial({ color: LIGHT ? 0x42566b : 0x1d2836, roughness: .6, metalness: .4 });
        function makeLabel(i){
          var c = document.createElement('canvas'); c.width = 512; c.height = 150;
          var tex = new THREE.CanvasTexture(c);
          var sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
          sp.scale.set(3.6, 1.05, 1);
          sp.position.set(SX[i], 3.35, 0);
          scene.add(sp);
          return { canvas: c, tex: tex, last: '' };
        }
        function drawLabel(i){
          var L = labelObjs[i], s = stations[i];
          var sub = fmt(effRate(i)) + ' unit/mnt · antre ' + s.queue.length + (s.slow < 1 ? ' · MELAMBAT' : '');
          var key = s.name + '|' + sub;
          if (L.last === key) return; L.last = key;
          var g = L.canvas.getContext('2d');
          g.clearRect(0,0,512,150);
          g.fillStyle = LIGHT ? 'rgba(255,255,255,.88)' : 'rgba(9,15,22,.78)';
          g.beginPath();
          var r = 26, w = 512, h = 150;
          g.moveTo(r,4); g.lineTo(w-r,4); g.quadraticCurveTo(w-4,4,w-4,r); g.lineTo(w-4,h-r);
          g.quadraticCurveTo(w-4,h-4,w-r,h-4); g.lineTo(r,h-4); g.quadraticCurveTo(4,h-4,4,h-r);
          g.lineTo(4,r); g.quadraticCurveTo(4,4,r,4); g.fill();
          g.fillStyle = ST_DEF[i].css;
          g.fillRect(28, 30, 10, 62);
          g.fillStyle = LIGHT ? '#15222f' : '#eef4fa';
          g.font = '600 47px Barlow, sans-serif';
          g.fillText(s.name, 56, 66);
          g.font = '500 36px "IBM Plex Mono", monospace';
          g.fillStyle = (s.slow < 1) ? '#e08c00' : (LIGHT ? '#5b7186' : '#9db4ca');
          g.fillText(sub, 56, 118);
          L.tex.needsUpdate = true;
        }

        ST_DEF.forEach(function(d, i){
          var grp = new THREE.Group();
          var accent = new THREE.MeshStandardMaterial({ color: d.color, roughness: .5, metalness: .3, emissive: d.color, emissiveIntensity: .18 });
          [-1.28, 1.28].forEach(function(z){
            var cab = new THREE.Mesh(new THREE.BoxGeometry(1.7, 1.5, 0.55), bodyMat);
            cab.position.set(SX[i], 0.75, z); cab.castShadow = true; grp.add(cab);
            var stripe = new THREE.Mesh(new THREE.BoxGeometry(1.72, 0.14, 0.57), accent);
            stripe.position.set(SX[i], 1.32, z); grp.add(stripe);
          });
          var beamM = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.55, 3.1), darkMat);
          beamM.position.set(SX[i], 1.78, 0); beamM.castShadow = true; grp.add(beamM);
          var beamStripe = new THREE.Mesh(new THREE.BoxGeometry(1.74, 0.12, 3.14), accent);
          beamStripe.position.set(SX[i], 1.98, 0); grp.add(beamStripe);
          /* control screen */
          var scr = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.42),
            new THREE.MeshBasicMaterial({ color: 0x67e8f9 }));
          scr.position.set(SX[i] - 0.4, 1.02, 1.565); grp.add(scr);
          var scrFrame = new THREE.Mesh(new THREE.BoxGeometry(0.74, 0.54, 0.05), darkMat);
          scrFrame.position.set(SX[i] - 0.4, 1.02, 1.545); grp.add(scrFrame);
          /* lamp pole */
          var pole = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1.5, 8), railMat);
          pole.position.set(SX[i] + 0.72, 2.2, 1.28); grp.add(pole);
          var lampMat = new THREE.MeshStandardMaterial({ color: 0x223044, emissive: 0x3ddc84, emissiveIntensity: 1.4, roughness: .35 });
          var lamp = new THREE.Mesh(new THREE.SphereGeometry(0.13, 16, 12), lampMat);
          lamp.position.set(SX[i] + 0.72, 3.0, 1.28); grp.add(lamp);
          lampMats.push(lampMat);
          /* invisible hitbox */
          var hit = new THREE.Mesh(new THREE.BoxGeometry(2.6, 3.4, 3.6),
            new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
          hit.position.set(SX[i], 1.6, 0); hit.userData.station = i;
          grp.add(hit); hitBoxes.push(hit);
          scene.add(grp);
          machineGroups.push(grp);
          labelObjs.push(makeLabel(i));
        });

        /* raw material stack (left) */
        for (var rm=0; rm<8; rm++){
          var b = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.55, 0.9), crateMats.raw);
          b.position.set(-21.6 + (rm%3)*1.0, 0.28 + Math.floor(rm/3)*0.57, -2.6);
          b.castShadow = true; scene.add(b);
        }
        /* warehouse racks (right) */
        var rackMat = new THREE.MeshStandardMaterial({ color: LIGHT ? 0x7d93a9 : 0x33465c, roughness: .6, metalness: .4 });
        for (var rk=0; rk<3; rk++){
          var rack = new THREE.Mesh(new THREE.BoxGeometry(0.5, 3.4, 4.6), rackMat);
          rack.position.set(24.6, 1.7, -3.4 + rk*3.6); rack.castShadow = true; scene.add(rack);
        }

        /* zone labels: material in / gudang */
        function zoneLabel(text, x, y, z, colorCss){
          var c = document.createElement('canvas'); c.width = 512; c.height = 110;
          var g = c.getContext('2d');
          g.font = '600 52px "Barlow Condensed", Barlow, sans-serif';
          g.textAlign = 'center';
          g.fillStyle = colorCss;
          g.fillText(text.toUpperCase(), 256, 68);
          var tex = new THREE.CanvasTexture(c);
          var sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
          sp.scale.set(4.2, 0.9, 1); sp.position.set(x, y, z);
          scene.add(sp);
        }
        zoneLabel('Material Masuk', -21.4, 2.2, -2.6, LIGHT ? '#5b7186' : '#9db4ca');
        zoneLabel('Gudang Jadi', 21.2, 3.4, 0, LIGHT ? '#5b7186' : '#9db4ca');

        /* ---- bottleneck marker ---- */
        marker = new THREE.Group();
        var ring = new THREE.Mesh(new THREE.RingGeometry(1.7, 2.05, 40),
          new THREE.MeshBasicMaterial({ color: 0xff5347, transparent: true, opacity: .85, side: THREE.DoubleSide }));
        ring.rotation.x = -Math.PI/2; ring.position.y = 0.03;
        marker.add(ring); marker.userData.ring = ring;
        var col = new THREE.Mesh(new THREE.CylinderGeometry(1.95, 1.95, 5.4, 32, 1, true),
          new THREE.MeshBasicMaterial({ color: 0xff5347, transparent: true, opacity: .07, side: THREE.DoubleSide, depthWrite: false }));
        col.position.y = 2.7; marker.add(col); marker.userData.col = col;
        markerLight = new THREE.PointLight(0xff5347, 1.1, 12);
        markerLight.position.y = 2.6; marker.add(markerLight);
        marker.position.set(SX[3], 0, 0);
        scene.add(marker);
        /* badge */
        var bc = document.createElement('canvas'); bc.width = bc.height = 128;
        var bg2 = bc.getContext('2d');
        bg2.beginPath(); bg2.arc(64,64,54,0,7); bg2.fillStyle = '#ff5347'; bg2.fill();
        bg2.lineWidth = 7; bg2.strokeStyle = '#ffffff'; bg2.stroke();
        bg2.fillStyle = '#fff'; bg2.font = '700 74px Barlow, sans-serif'; bg2.textAlign = 'center';
        bg2.fillText('!', 64, 92);
        badge = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(bc), transparent: true, depthWrite: false }));
        badge.scale.set(0.85, 0.85, 1);
        scene.add(badge);

        /* steam particles at bottleneck */
        var pGeo = new THREE.BufferGeometry();
        var pCount = 42, pPos = new Float32Array(pCount*3);
        particleData = [];
        for (var pi=0; pi<pCount; pi++){
          particleData.push({ a: Math.random()*6.28, r: 0.4 + Math.random()*0.9, y: Math.random()*3, s: 0.7 + Math.random()*0.9 });
        }
        pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
        particles = new THREE.Points(pGeo, new THREE.PointsMaterial({
          color: 0xff9a8a, size: 0.17, transparent: true, opacity: .75, depthWrite: false }));
        particles.visible = false;
        scene.add(particles);

        /* ---- camera controls (custom orbit) ---- */
        function applyCam(){
          var sp = Math.sin(sph.phi), x = targetVec.x + sph.r * sp * Math.sin(sph.theta),
              y = targetVec.y + sph.r * Math.cos(sph.phi),
              z = targetVec.z + sph.r * sp * Math.cos(sph.theta);
          camera.position.set(x, Math.max(y, 0.6), z);
          camera.lookAt(targetVec);
        }
        function resize(){
          var w = wrap.clientWidth, h = wrap.clientHeight;
          if (!w || !h) return;
          renderer.setSize(w, h, false);
          camera.aspect = w/h; camera.updateProjectionMatrix();
        }
        window.addEventListener('resize', resize);
        resize();
        if (wrap.clientWidth < wrap.clientHeight) sph.r = 47; /* portrait: pull back so the whole line fits */

        var dragging = false, lastX = 0, lastY = 0, downX = 0, downY = 0, pinchD = 0;
        canvas.addEventListener('pointerdown', function(e){
          dragging = true; lastX = downX = e.clientX; lastY = downY = e.clientY;
          camAnim = null; canvas.setPointerCapture(e.pointerId);
        });
        canvas.addEventListener('pointermove', function(e){
          if (!dragging) return;
          var dx = e.clientX - lastX, dy = e.clientY - lastY;
          lastX = e.clientX; lastY = e.clientY;
          sph.theta -= dx * 0.0052;
          sph.phi = Math.min(1.45, Math.max(0.12, sph.phi - dy * 0.0052));
        });
        canvas.addEventListener('pointerup', function(e){
          dragging = false;
          if (Math.hypot(e.clientX - downX, e.clientY - downY) < 6){
            var rect = canvas.getBoundingClientRect();
            var mouse = new THREE.Vector2(
              ((e.clientX - rect.left)/rect.width)*2 - 1,
              -((e.clientY - rect.top)/rect.height)*2 + 1);
            var rc = new THREE.Raycaster();
            rc.setFromCamera(mouse, camera);
            var hits = rc.intersectObjects(hitBoxes);
            if (hits.length) focusStation(hits[0].object.userData.station, true);
          }
        });
        canvas.addEventListener('wheel', function(e){
          e.preventDefault();
          sph.r = Math.min(60, Math.max(9, sph.r * (e.deltaY > 0 ? 1.09 : 0.92)));
        }, { passive: false });
        canvas.addEventListener('touchstart', function(e){
          if (e.touches.length === 2)
            pinchD = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
        }, { passive: true });
        canvas.addEventListener('touchmove', function(e){
          if (e.touches.length === 2 && pinchD > 0){
            var d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
            sph.r = Math.min(60, Math.max(9, sph.r * pinchD / Math.max(d, 1)));
            pinchD = d;
          }
        }, { passive: true });

        function animCamTo(theta, phi, r, tx, ty, tz){
          var from = { theta: sph.theta, phi: sph.phi, r: sph.r, x: targetVec.x, y: targetVec.y, z: targetVec.z };
          var to = { theta: theta, phi: phi, r: r, x: tx, y: ty, z: tz };
          if (REDUCED){ sph.theta = theta; sph.phi = phi; sph.r = r; targetVec.set(tx, ty, tz); return; }
          camAnim = { t: 0, from: from, to: to };
        }
        function focusStation(i, flashSlider){
          animCamTo(sph.theta, 1.05, 13.5, SX[i], 0.9, 0);
          if (flashSlider){
            var box = document.getElementById('sl-box-' + i);
            box.classList.add('flash');
            setTimeout(function(){ box.classList.remove('flash'); }, 1200);
          }
        }
        var camBtns = document.querySelectorAll('[data-cam]');
        camBtns.forEach(function(b){
          b.addEventListener('click', function(){
            var k = b.dataset.cam;
            if (k === 'orbit'){
              autoOrbit = !autoOrbit;
              b.classList.toggle('on', autoOrbit);
              return;
            }
            camBtns.forEach(function(x){ if (x.dataset.cam !== 'orbit') x.classList.toggle('on', x === b); });
            if (k === 'iso') animCamTo(0.85, 1.02, 35, 1.2, 0.7, 0);
            else if (k === 'top') animCamTo(0.85, 0.14, 42, 0, 0.4, 0);
            else if (k === 'side') animCamTo(0.02, 1.28, 30, 0, 0.9, 0);
            else if (k === 'focus' && bottleneckIdx >= 0) focusStation(bottleneckIdx, false);
          });
        });

        /* warm-up items may lack meshes if created before scene existed — handled because
           resetSim ran before this block; create meshes for existing items now */
        items.forEach(function(it){ if (!it.mesh && window.__makeCrate) window.__makeCrate(it); });

        /* ---- render loop ---- */
        var clockT = new THREE.Clock();
        var tmpV = new THREE.Vector3();
        var hudTimer = 0, labelTimer = 0;
        function loop(){
          var dtR = Math.min(clockT.getDelta(), 0.06);
          var tNow = clockT.elapsedTime;

          if (running){
            stepSim(dtR * speedMul * (1/6));
            beltTex.offset.x -= dtR * (0.6 + speedMul * 0.35);
          }

          /* crates follow sim */
          for (var k=0;k<items.length;k++){
            var it = items[k];
            if (!it.mesh) continue;
            crateTarget(it, tmpV);
            if (it.snap){ it.mesh.position.copy(tmpV); it.snap = false; }
            else {
              var f = 1 - Math.exp(-dtR * 5.5);
              it.mesh.position.lerp(tmpV, f);
            }
            var wantMat = it.state === 'stack' ? crateMats.done : (it.st >= 4 ? crateMats.painted : crateMats.raw);
            if (it.mesh.material !== wantMat) it.mesh.material = wantMat;
          }

          /* lamps */
          for (var li=0; li<N; li++){
            var s = stations[li], m = lampMats[li];
            var colr = (li === bottleneckIdx) ? 0xff5347 : (s.current ? 0x3ddc84 : (s.queue.length ? 0xffb02e : 0x54687c));
            m.emissive.setHex(colr);
            m.emissiveIntensity = (li === bottleneckIdx) ? (1.3 + Math.sin(tNow*6)*0.7) : 1.2;
          }

          /* bottleneck marker follows */
          if (bottleneckIdx >= 0){
            var tx = SX[bottleneckIdx];
            marker.position.x += (tx - marker.position.x) * Math.min(1, dtR*2.2);
            var pulse = REDUCED ? 1 : (1 + Math.sin(tNow*3.2)*0.1);
            marker.userData.ring.scale.set(pulse, pulse, 1);
            marker.userData.ring.material.opacity = 0.65 + (REDUCED ? 0.15 : Math.sin(tNow*3.2)*0.25);
            marker.userData.col.material.opacity = 0.05 + (REDUCED ? 0.02 : (Math.sin(tNow*3.2)*0.5+0.5)*0.05);
            markerLight.intensity = 0.9 + (REDUCED ? 0 : Math.sin(tNow*3.2)*0.35);
            badge.position.set(marker.position.x, 4.15 + (REDUCED ? 0 : Math.sin(tNow*2.1)*0.13), 0);
            /* steam when queue is long */
            var showP = stations[bottleneckIdx].queue.length >= 5;
            particles.visible = showP;
            if (showP){
              var arr = particles.geometry.attributes.position.array;
              for (var pi2=0; pi2<particleData.length; pi2++){
                var pd = particleData[pi2];
                pd.y += dtR * pd.s * 1.5;
                if (pd.y > 3.4){ pd.y = 0; pd.a = Math.random()*6.28; }
                arr[pi2*3]   = marker.position.x + Math.cos(pd.a + pd.y*0.7) * pd.r * (0.5 + pd.y*0.25);
                arr[pi2*3+1] = 2.1 + pd.y;
                arr[pi2*3+2] = Math.sin(pd.a + pd.y*0.7) * pd.r * (0.5 + pd.y*0.25);
              }
              particles.geometry.attributes.position.needsUpdate = true;
            }
          }

          /* camera */
          if (camAnim){
            camAnim.t += dtR / 0.9;
            var e = camAnim.t >= 1 ? 1 : (1 - Math.pow(1 - camAnim.t, 3));
            var A = camAnim.from, B = camAnim.to;
            sph.theta = A.theta + (B.theta - A.theta)*e;
            sph.phi = A.phi + (B.phi - A.phi)*e;
            sph.r = A.r + (B.r - A.r)*e;
            targetVec.set(A.x + (B.x - A.x)*e, A.y + (B.y - A.y)*e, A.z + (B.z - A.z)*e);
            if (camAnim.t >= 1) camAnim = null;
          } else if (autoOrbit && !dragging){
            sph.theta += dtR * 0.07;
          }
          applyCam();
          renderer.render(scene, camera);

          hudTimer += dtR; labelTimer += dtR;
          if (hudTimer > 0.25){ hudTimer = 0; updateHUD(); }
          if (labelTimer > 0.5){
            labelTimer = 0;
            for (var lj=0; lj<N; lj++) drawLabel(lj);
            if (running) computeRec();
          }
        }
        renderer.setAnimationLoop(loop);
        for (var li2=0; li2<N; li2++) drawLabel(li2);
        if (document.fonts && document.fonts.ready){
          document.fonts.ready.then(function(){
            labelObjs.forEach(function(L){ L.last = ''; });
            for (var lf=0; lf<N; lf++) drawLabel(lf);
          });
        }
      } else {
        /* no WebGL: drive HUD from a plain timer so panels stay alive */
        fallbackTimer = setInterval(function(){
          if (running) stepSim(0.05 * speedMul);
          updateHUD();
        }, 300);
      }
    
      /* ---------- cleanup (Next.js unmount) ---------- */
      function cleanup(){
        try{
          if (typeof renderer !== 'undefined' && renderer){
            renderer.setAnimationLoop(null);
            if (renderer.dispose) renderer.dispose();
          }
        }catch(e){}
        try{ if (fallbackTimer) clearInterval(fallbackTimer); }catch(e){}
        try{ window.removeEventListener('resize', resize); }catch(e){}
        try{ delete window.__clearMeshes; delete window.__dropCrate; delete window.__makeCrate; }catch(e){}
      }
      return cleanup;
}
