/* ============================================================
   まちあるき学習アプリ - 生徒用 (student.js)
   ============================================================ */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);

  let course = null;
  let progress = null;
  let map = null;
  let markers = {};          // spotId -> L.marker
  let userMarker = null;
  let userCircle = null;
  let testMode = false;      // 練習モード（GPSなしで開錠）
  let currentSpotId = null;
  let lastPos = null;        // {lat, lng, acc}

  /* ---------------- 初期化 ---------------- */
  async function init() {
    course = await Machi.getCourseFromURL();
    if (!course) {
      showNoCourse();
      return;
    }
    const err = Machi.validateCourse(course);
    if (err) { showNoCourse(err); return; }

    progress = Machi.loadProgress(course.id);
    $('courseTitle').textContent = course.title || 'まちあるき学習';

    initMap();
    renderMarkers();
    if (hasKeyword()) {
      $('keywordBtn').style.display = '';
      updateLettersBar();
    }
    updateProgress();
    bindUI();
  }

  function showNoCourse(msg) {
    document.querySelector('.app').innerHTML =
      '<div style="padding:40px 24px;max-width:560px;margin:0 auto;text-align:center;">' +
      '<h1 style="color:#1f7a5a;">まちあるき学習アプリ</h1>' +
      '<p style="color:#6b7280;line-height:1.8;">' +
      (msg ? Machi.esc(msg) + '<br>' : '') +
      'コースが読み込まれていません。<br>先生から配布された<b>生徒用リンク</b>を開いてください。</p>' +
      '<p><a class="btn outline" style="display:inline-flex;width:auto;text-decoration:none;" href="editor.html">コースを作る（先生用）</a></p>' +
      '</div>';
  }

  /* ---------------- 地図 ---------------- */
  function initMap() {
    const first = course.spots[0];
    const center = first ? [first.lat, first.lng] : [26.2124, 127.6809]; // 那覇
    map = L.map('map', { zoomControl: true }).setView(center, 16);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap',
    }).addTo(map);

    // すべてのスポットが入るよう調整
    if (course.spots.length > 1) {
      const bounds = L.latLngBounds(course.spots.map((s) => [s.lat, s.lng]));
      map.fitBounds(bounds, { padding: [50, 50] });
    }
  }

  function spotIcon(spot, idx) {
    const sp = Machi.getSpotProgress(progress, spot.id);
    const cls = 'spot-marker' + (sp.arrived ? ' arrived' : '') +
      (spot.id === currentSpotId ? ' active' : '');
    return L.divIcon({
      className: '',
      html: '<div class="' + cls + '">' + (sp.arrived ? '✓' : (idx + 1)) + '</div>',
      iconSize: [30, 30],
      iconAnchor: [15, 15],
    });
  }

  function renderMarkers() {
    course.spots.forEach((spot, idx) => {
      if (markers[spot.id]) map.removeLayer(markers[spot.id]);
      const m = L.marker([spot.lat, spot.lng], { icon: spotIcon(spot, idx) }).addTo(map);
      m.on('click', () => openSheet(spot.id));
      markers[spot.id] = m;
    });
    // ルート線
    if (course.spots.length > 1) {
      if (window._routeLine) map.removeLayer(window._routeLine);
      window._routeLine = L.polyline(course.spots.map((s) => [s.lat, s.lng]),
        { color: '#1f7a5a', weight: 3, opacity: .5, dashArray: '6,8' }).addTo(map);
    }
  }

  function refreshMarker(spotId) {
    const idx = course.spots.findIndex((s) => s.id === spotId);
    if (idx >= 0 && markers[spotId]) markers[spotId].setIcon(spotIcon(course.spots[idx], idx));
  }

  /* ---------------- 進捗 ---------------- */
  function isComplete(spot) {
    return Machi.isSpotComplete(spot, Machi.getSpotProgress(progress, spot.id));
  }

  function updateProgress() {
    const total = course.spots.length;
    const done = course.spots.filter(isComplete).length;
    $('progressText').textContent = done + ' / ' + total;
    $('progressFill').style.width = total ? (done / total) * 100 + '%' : '0%';
    updateLettersBar();
  }

  function hasKeyword() {
    return !!(course.keyword && course.keyword.length);
  }

  function updateLettersBar() {
    if (!hasKeyword()) return;
    const bar = $('lettersBar');
    const letters = Machi.collectedLetters(course, progress); // [文字 or null]
    const cells = letters
      .filter((_, i) => course.spots[i].collectLetter)
      .map((l) => '<div class="cell' + (l ? ' filled' : '') + '">' + (l ? Machi.esc(l) : '?') + '</div>')
      .join('');
    bar.innerHTML = '<span class="lab">🔑 あつめた文字</span>' + cells;
    bar.style.display = 'flex';
  }

  /* ---------------- 位置情報 ---------------- */
  function bindUI() {
    $('locateBtn').addEventListener('click', startLocate);
    $('testToggle').addEventListener('click', () => {
      testMode = !testMode;
      $('testToggle').textContent = testMode ? '🔒 練習モード中' : '🔓 練習モード';
      $('testToggle').style.background = testMode ? '#f0a500' : '';
      $('testToggle').style.color = testMode ? '#fff' : '';
      toast(testMode ? '練習モード：GPSなしで開錠できます' : '練習モードを解除しました');
      if (currentSpotId) openSheet(currentSpotId); // 再描画
    });
    $('reviewBtn').addEventListener('click', openReview);
    $('reviewClose').addEventListener('click', () => $('reviewOverlay').classList.remove('open'));
    $('sheetBackdrop').addEventListener('click', closeSheet);
    $('keywordBtn').addEventListener('click', () => openGoal(false));
  }

  let watchId = null;
  function startLocate() {
    if (!navigator.geolocation) { toast('この端末では位置情報が使えません'); return; }
    toast('現在地を取得中…');
    if (watchId != null) navigator.geolocation.clearWatch(watchId);
    watchId = navigator.geolocation.watchPosition(
      onPosition,
      (err) => {
        toast('位置情報を取得できません（' + err.message + '）');
      },
      { enableHighAccuracy: true, maximumAge: 3000, timeout: 15000 }
    );
  }

  function onPosition(pos) {
    const { latitude: lat, longitude: lng, accuracy: acc } = pos.coords;
    lastPos = { lat, lng, acc };
    if (!userMarker) {
      userMarker = L.circleMarker([lat, lng], {
        radius: 8, color: '#1d4ed8', fillColor: '#3b82f6', fillOpacity: 1, weight: 3,
      }).addTo(map);
      userCircle = L.circle([lat, lng], { radius: acc, color: '#3b82f6', opacity: .3, fillOpacity: .08 }).addTo(map);
      map.setView([lat, lng], 17);
    } else {
      userMarker.setLatLng([lat, lng]);
      userCircle.setLatLng([lat, lng]).setRadius(acc);
    }
    checkArrivals();
    if (currentSpotId) refreshSheetDistance();
  }

  // スポット到着判定
  function checkArrivals() {
    if (!lastPos) return;
    course.spots.forEach((spot) => {
      const sp = Machi.getSpotProgress(progress, spot.id);
      const d = Machi.distanceMeters(lastPos.lat, lastPos.lng, spot.lat, spot.lng);
      const radius = spot.radius || 40;
      if (!sp.arrived && d <= radius) {
        sp.arrived = true;
        Machi.saveProgress(course.id, progress);
        refreshMarker(spot.id);
        updateProgress();
        toast('「' + spot.name + '」に到着！🎉');
      }
    });
  }

  function isUnlocked(spot) {
    const sp = Machi.getSpotProgress(progress, spot.id);
    return testMode || sp.arrived || spot.gpsRequired === false;
  }

  function distanceTo(spot) {
    if (!lastPos) return null;
    return Math.round(Machi.distanceMeters(lastPos.lat, lastPos.lng, spot.lat, spot.lng));
  }

  /* ---------------- スポット詳細シート ---------------- */
  function openSheet(spotId) {
    currentSpotId = spotId;
    renderSheet();
    $('sheet').classList.add('open');
    $('sheetBackdrop').classList.add('open');
    refreshMarker(spotId);
  }
  function closeSheet() {
    $('sheet').classList.remove('open');
    $('sheetBackdrop').classList.remove('open');
    const id = currentSpotId; currentSpotId = null;
    if (id) refreshMarker(id);
  }

  function refreshSheetDistance() {
    const el = document.getElementById('distBadge');
    if (!el) return;
    const spot = course.spots.find((s) => s.id === currentSpotId);
    const d = distanceTo(spot);
    el.textContent = d != null ? 'あと約 ' + d + ' m' : '距離: 不明';
  }

  function renderSheet() {
    const spot = course.spots.find((s) => s.id === currentSpotId);
    if (!spot) return;
    const sp = Machi.getSpotProgress(progress, spot.id);
    const unlocked = isUnlocked(spot);
    const d = distanceTo(spot);
    const idx = course.spots.findIndex((s) => s.id === spot.id);

    let html = '';
    html += '<h2>' + (idx + 1) + '. ' + Machi.esc(spot.name) + '</h2>';
    html += sp.arrived
      ? '<span class="badge arrived">到着ずみ ✓</span>'
      : '<span class="badge locked">未到着</span>';
    html += '<span class="badge dist" id="distBadge">' +
      (d != null ? 'あと約 ' + d + ' m' : '距離: 不明') + '</span>';

    // 説明
    if (spot.info) {
      html += '<div class="section"><div class="section-label">📖 スポット情報</div>' +
        '<div class="info-text">' + Machi.esc(spot.info) + '</div></div>';
    }

    if (!unlocked) {
      html += '<div class="section"><div class="locked-note">📍 このスポットに近づくと、課題とクイズができるようになります。' +
        '<br>（試しに使うときは下の「練習モード」をON）</div></div>';
      $('sheetContent').innerHTML = html;
      return;
    }

    // 課題（写真・メモ）
    if (spot.task || true) {
      html += '<div class="section"><div class="section-label">✍️ 課題・記録</div>';
      if (spot.task) html += '<div class="info-text" style="margin-bottom:8px;">' + Machi.esc(spot.task) + '</div>';
      html += '<textarea class="memo" id="memoInput" placeholder="気づいたこと・メモを書こう">' +
        Machi.esc(sp.memo || '') + '</textarea>';
      html += '<div style="display:flex;gap:8px;margin-top:8px;">' +
        '<label class="btn outline" style="width:auto;cursor:pointer;">📷 写真をとる' +
        '<input type="file" accept="image/*" capture="environment" id="photoInput" style="display:none;"></label>' +
        '<button class="btn secondary small" id="saveMemoBtn">メモを保存</button></div>';
      html += '<div class="photo-grid" id="photoGrid"></div>';
      html += '</div>';
    }

    // クイズ（正解するまで何度でも再挑戦。間違えるとヒント）
    if (Machi.hasQuiz(spot)) {
      const solved = sp.quizCorrect === true;
      const wrongOnce = !solved && sp.quizAnswer != null && sp.quizCorrect === false;
      html += '<div class="section"><div class="section-label">❓ クイズ</div>';
      html += '<div class="info-text" style="margin-bottom:8px;">' + Machi.esc(spot.quiz.question) + '</div>';
      (spot.quiz.choices || []).forEach((ch, i) => {
        let cls = 'choice';
        if (solved) {
          if (i === spot.quiz.answer) cls += ' correct';
        } else if (wrongOnce && i === sp.quizAnswer) {
          cls += ' wrong';
        }
        html += '<button class="' + cls + '" data-choice="' + i + '"' +
          (solved ? ' disabled' : '') + '>' + Machi.esc(ch) + '</button>';
      });
      if (solved) {
        html += '<div class="quiz-result ok">正解！🎉' +
          (spot.collectLetter ? '　文字「' + Machi.esc(spot.collectLetter) + '」をゲット！' : '') + '</div>';
        if (spot.quiz.explanation) {
          html += '<div class="info-text" style="margin-top:6px;">' + Machi.esc(spot.quiz.explanation) + '</div>';
        }
      } else if (wrongOnce) {
        html += '<div class="quiz-result ng">ざんねん！ もう一度チャレンジ！</div>';
        const hint = spot.quiz.hint || '';
        if (hint) html += '<div class="locked-note" style="margin-top:6px;">💡 ヒント：' + Machi.esc(hint) + '</div>';
      }
      html += '</div>';
    }

    $('sheetContent').innerHTML = html;
    wireSheetEvents(spot, sp);
    loadPhotos(spot, sp);
  }

  function wireSheetEvents(spot, sp) {
    const memoBtn = $('saveMemoBtn');
    if (memoBtn) {
      memoBtn.addEventListener('click', () => {
        sp.memo = $('memoInput').value;
        Machi.saveProgress(course.id, progress);
        toast('メモを保存しました');
      });
    }
    const photoInput = $('photoInput');
    if (photoInput) {
      photoInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        toast('写真を保存中…');
        try {
          const dataUrl = await Machi.compressImage(file, 1000, 0.7);
          const key = Machi.uid('photo');
          await Machi.savePhoto(key, dataUrl);
          sp.photoKeys.push(key);
          Machi.saveProgress(course.id, progress);
          loadPhotos(spot, sp);
          toast('写真を保存しました 📷');
        } catch (err) {
          toast('写真の保存に失敗しました');
        }
        e.target.value = '';
      });
    }
    document.querySelectorAll('.choice[data-choice]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (sp.quizCorrect === true) return; // 正解後はロック
        const i = parseInt(btn.dataset.choice, 10);
        const correct = i === spot.quiz.answer;
        sp.quizAnswer = i;
        sp.quizCorrect = correct;
        sp.attempts = (sp.attempts || 0) + 1;
        if (correct) sp.arrived = true; // クリア＝到着あつかい
        Machi.saveProgress(course.id, progress);
        renderSheet();
        refreshMarker(spot.id);
        updateProgress();
        if (correct) {
          toast(spot.collectLetter ? '正解！文字「' + spot.collectLetter + '」ゲット🎉' : '正解！🎉');
          // 全ミッションクリアでゴール画面
          if (hasKeyword() && course.spots.every(isComplete)) {
            setTimeout(() => { closeSheet(); openGoal(true); }, 700);
          }
        } else {
          toast('ざんねん！ ヒントを見てもう一度');
        }
      });
    });
  }

  async function loadPhotos(spot, sp) {
    const grid = $('photoGrid');
    if (!grid) return;
    grid.innerHTML = '';
    for (const key of sp.photoKeys) {
      const dataUrl = await Machi.getPhoto(key);
      if (!dataUrl) continue;
      const div = document.createElement('div');
      div.className = 'photo-thumb';
      div.innerHTML = '<img src="' + dataUrl + '"><button data-key="' + key + '">×</button>';
      div.querySelector('button').addEventListener('click', async () => {
        await Machi.deletePhoto(key);
        sp.photoKeys = sp.photoKeys.filter((k) => k !== key);
        Machi.saveProgress(course.id, progress);
        loadPhotos(spot, sp);
      });
      grid.appendChild(div);
    }
  }

  /* ---------------- ゴール／キーワード画面 ---------------- */
  function openGoal(celebrate) {
    const done = course.spots.every(isComplete);
    const letterSpots = course.spots.filter((s) => s.collectLetter);
    const cells = letterSpots.map((s) => {
      const sp = Machi.getSpotProgress(progress, s.id);
      const got = Machi.isSpotComplete(s, sp);
      return '<div class="kc' + (got ? '' : ' empty') + '">' + (got ? Machi.esc(s.collectLetter) : '?') + '</div>';
    }).join('');
    const remaining = course.spots.filter((s) => !isComplete(s)).length;

    let html = '<button class="btn small secondary" id="goalClose" style="width:auto;">← もどる</button>';
    if (done) {
      html += '<div class="goal-hero">' + (celebrate ? '🎉🎊' : '🔑') + '</div>';
      html += '<div class="goal-title">キーワード完成！</div>';
      html += '<div class="keyword-cells">' + cells + '</div>';
      html += '<div class="goal-card"><div style="font-size:22px;font-weight:800;color:#1f7a5a;">「' +
        Machi.esc(course.keyword) + '」</div>';
      if (course.keywordHint) html += '<div class="muted" style="margin-top:6px;">' + Machi.esc(course.keywordHint) + '</div>';
      html += '</div>';
      if (course.goalText) html += '<div class="goal-card" style="background:#fff3d6;border-color:#ffe6a8;">🏁 ' + Machi.esc(course.goalText) + '</div>';
    } else {
      html += '<div class="goal-hero">🔑</div>';
      html += '<div class="goal-title">あと ' + remaining + ' ミッション！</div>';
      html += '<div class="keyword-cells">' + cells + '</div>';
      html += '<div class="goal-card">黄色の文字を ①→⑥ の順にあつめると、キーワードが完成するよ。<br>のこりのミッションにチャレンジしよう！</div>';
    }
    if (course.contact) html += '<div class="goal-contact">こまったら… ' + Machi.esc(course.contact) + '</div>';

    $('goalContent').innerHTML = html;
    $('goalOverlay').classList.add('open');
    $('goalClose').addEventListener('click', () => $('goalOverlay').classList.remove('open'));
  }

  /* ---------------- ふりかえり ---------------- */
  async function openReview() {
    const total = course.spots.length;
    const done = course.spots.filter(isComplete).length;
    const quizzes = course.spots.filter((s) => s.quiz && s.quiz.question);
    const quizDone = quizzes.filter((s) => Machi.getSpotProgress(progress, s.id).quizCorrect != null);
    const quizOk = quizzes.filter((s) => Machi.getSpotProgress(progress, s.id).quizCorrect === true);

    let html = '<div class="review-card" style="text-align:center;">' +
      '<div>到着スポット</div><div class="score-big">' + done + ' / ' + total + '</div>';
    if (quizzes.length) {
      html += '<div style="margin-top:8px;">クイズ正解数</div><div class="score-big">' +
        quizOk.length + ' / ' + quizzes.length + '</div>';
    }
    html += '</div>';

    for (const spot of course.spots) {
      const sp = Machi.getSpotProgress(progress, spot.id);
      const idx = course.spots.indexOf(spot);
      html += '<div class="review-card"><h3>' + (idx + 1) + '. ' + Machi.esc(spot.name) + ' ' +
        (sp.arrived ? '✓' : '<span class="muted">未到着</span>') + '</h3>';
      if (sp.memo) html += '<div class="info-text">📝 ' + Machi.esc(sp.memo) + '</div>';
      if (spot.quiz && spot.quiz.question && sp.quizCorrect != null) {
        html += '<div class="muted">クイズ：' + (sp.quizCorrect ? '正解 ⭕️' : '不正解 ❌') + '</div>';
      }
      html += '<div class="photo-grid" data-photos="' + spot.id + '"></div></div>';
    }
    html += '<button class="btn outline" id="exportBtn" style="margin-top:8px;">記録を書き出す（テキスト）</button>';

    $('reviewContent').innerHTML = html;
    $('reviewOverlay').classList.add('open');

    // 写真ロード
    for (const spot of course.spots) {
      const sp = Machi.getSpotProgress(progress, spot.id);
      const grid = document.querySelector('[data-photos="' + spot.id + '"]');
      for (const key of sp.photoKeys) {
        const dataUrl = await Machi.getPhoto(key);
        if (dataUrl) {
          const img = document.createElement('img');
          img.src = dataUrl;
          grid.appendChild(img);
        }
      }
    }
    $('exportBtn').addEventListener('click', exportText);
  }

  function exportText() {
    let txt = '【' + (course.title || 'まちあるき') + '】ふりかえり記録\n\n';
    course.spots.forEach((spot, i) => {
      const sp = Machi.getSpotProgress(progress, spot.id);
      txt += (i + 1) + '. ' + spot.name + (sp.arrived ? '（到着）' : '（未到着）') + '\n';
      if (sp.memo) txt += '  メモ: ' + sp.memo + '\n';
      if (spot.quiz && sp.quizCorrect != null) txt += '  クイズ: ' + (sp.quizCorrect ? '正解' : '不正解') + '\n';
      txt += '\n';
    });
    const blob = new Blob([txt], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (course.title || 'machiaruki') + '_記録.txt';
    a.click();
  }

  /* ---------------- トースト ---------------- */
  let toastTimer = null;
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2400);
  }

  init();
})();
