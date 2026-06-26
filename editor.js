/* ============================================================
   まちあるき学習アプリ - 先生用エディタ (editor.js)
   ============================================================ */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);

  let course = null;
  let map = null;
  let markers = {};       // spotId -> marker
  let activeId = null;
  const DRAFT_KEY = 'machi:draft';

  function init() {
    course = loadDraft() || Machi.emptyCourse();
    $('courseTitle').value = course.title || '';
    $('courseDesc').value = course.description || '';
    $('courseKeyword').value = course.keyword || '';
    $('courseKeywordHint').value = course.keywordHint || '';
    $('courseGoalText').value = course.goalText || '';
    $('courseContact').value = course.contact || '';

    initMap();
    renderSpotList();
    renderMarkers();
    bindUI();
  }

  /* ---------- 下書き保存（自動） ---------- */
  function saveDraft() {
    course.title = $('courseTitle').value.trim();
    course.description = $('courseDesc').value.trim();
    course.keyword = $('courseKeyword').value.trim();
    course.keywordHint = $('courseKeywordHint').value.trim();
    course.goalText = $('courseGoalText').value.trim();
    course.contact = $('courseContact').value.trim();
    localStorage.setItem(DRAFT_KEY, JSON.stringify(course));
  }
  function loadDraft() {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  /* ---------- 地図 ---------- */
  function initMap() {
    const center = course.spots[0]
      ? [course.spots[0].lat, course.spots[0].lng]
      : [26.2124, 127.6809]; // 那覇
    map = L.map('emap').setView(center, 16);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '&copy; OpenStreetMap',
    }).addTo(map);
    map.on('click', (e) => addSpot(e.latlng.lat, e.latlng.lng));
    if (course.spots.length > 1) {
      map.fitBounds(L.latLngBounds(course.spots.map((s) => [s.lat, s.lng])), { padding: [50, 50] });
    }
  }

  function markerIcon(idx, active) {
    return L.divIcon({
      className: '',
      html: '<div class="spot-marker' + (active ? ' active' : '') + '">' + (idx + 1) + '</div>',
      iconSize: [30, 30], iconAnchor: [15, 15],
    });
  }

  function renderMarkers() {
    Object.values(markers).forEach((m) => map.removeLayer(m));
    markers = {};
    course.spots.forEach((spot, idx) => {
      const m = L.marker([spot.lat, spot.lng], {
        icon: markerIcon(idx, spot.id === activeId), draggable: true,
      }).addTo(map);
      m.on('click', () => selectSpot(spot.id));
      m.on('dragend', () => {
        const ll = m.getLatLng();
        spot.lat = +ll.lat.toFixed(6);
        spot.lng = +ll.lng.toFixed(6);
        if (spot.id === activeId) { $('sLat').value = spot.lat; $('sLng').value = spot.lng; }
        saveDraft();
      });
      markers[spot.id] = m;
    });
    if (window._line) map.removeLayer(window._line);
    if (course.spots.length > 1) {
      window._line = L.polyline(course.spots.map((s) => [s.lat, s.lng]),
        { color: '#1f7a5a', weight: 3, opacity: .5, dashArray: '6,8' }).addTo(map);
    }
  }

  /* ---------- スポット追加 ---------- */
  function addSpot(lat, lng) {
    const spot = {
      id: Machi.uid('spot'),
      name: 'スポット' + (course.spots.length + 1),
      lat: +lat.toFixed(6), lng: +lng.toFixed(6),
      radius: 40, info: '', task: '',
      gpsRequired: true, collectLetter: '',
      quiz: { question: '', choices: [], answer: 0, hint: '', explanation: '' },
    };
    course.spots.push(spot);
    saveDraft();
    renderSpotList();
    renderMarkers();
    selectSpot(spot.id);
    toast('スポットを追加しました');
  }

  /* ---------- 一覧 ---------- */
  function renderSpotList() {
    const list = $('spotList');
    if (!course.spots.length) {
      list.innerHTML = '<p class="muted">まだスポットがありません。地図をクリックして追加してください。</p>';
      return;
    }
    list.innerHTML = '';
    course.spots.forEach((spot, idx) => {
      const div = document.createElement('div');
      div.className = 'spot-item' + (spot.id === activeId ? ' active' : '');
      div.innerHTML =
        '<div class="row"><div class="num">' + (idx + 1) + '</div>' +
        '<div class="name">' + Machi.esc(spot.name) + '</div>' +
        '<button class="btn secondary small" data-up>↑</button>' +
        '<button class="btn secondary small" data-down>↓</button></div>';
      div.querySelector('.name').addEventListener('click', () => selectSpot(spot.id));
      div.querySelector('.num').addEventListener('click', () => selectSpot(spot.id));
      div.querySelector('[data-up]').addEventListener('click', (e) => { e.stopPropagation(); move(idx, -1); });
      div.querySelector('[data-down]').addEventListener('click', (e) => { e.stopPropagation(); move(idx, 1); });
      list.appendChild(div);
    });
  }

  function move(idx, dir) {
    const j = idx + dir;
    if (j < 0 || j >= course.spots.length) return;
    const tmp = course.spots[idx];
    course.spots[idx] = course.spots[j];
    course.spots[j] = tmp;
    saveDraft();
    renderSpotList();
    renderMarkers();
  }

  /* ---------- スポット選択・編集 ---------- */
  function selectSpot(id) {
    activeId = id;
    const spot = course.spots.find((s) => s.id === id);
    if (!spot) return;
    $('spotEditor').style.display = 'block';
    $('editorTitle').textContent = 'スポットを編集：' + spot.name;
    $('sName').value = spot.name || '';
    $('sLat').value = spot.lat;
    $('sLng').value = spot.lng;
    $('sRadius').value = spot.radius || 40;
    $('sGpsRequired').checked = spot.gpsRequired !== false;
    $('sCollectLetter').value = spot.collectLetter || '';
    $('sInfo').value = spot.info || '';
    $('sTask').value = spot.task || '';
    const q = spot.quiz || {};
    $('qQuestion').value = q.question || '';
    $('qChoices').value = (q.choices || []).join('\n');
    $('qAnswer').value = (q.answer != null ? q.answer : 0) + 1;
    $('qHint').value = q.hint || '';
    $('qExplain').value = q.explanation || '';

    renderSpotList();
    renderMarkers();
    map.panTo([spot.lat, spot.lng]);
    $('spotEditor').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function saveSpot() {
    const spot = course.spots.find((s) => s.id === activeId);
    if (!spot) return;
    spot.name = $('sName').value.trim() || 'スポット';
    spot.lat = parseFloat($('sLat').value) || spot.lat;
    spot.lng = parseFloat($('sLng').value) || spot.lng;
    spot.radius = parseInt($('sRadius').value, 10) || 40;
    spot.gpsRequired = $('sGpsRequired').checked;
    spot.collectLetter = $('sCollectLetter').value.trim();
    spot.info = $('sInfo').value.trim();
    spot.task = $('sTask').value.trim();
    const choices = $('qChoices').value.split('\n').map((s) => s.trim()).filter(Boolean);
    const ans = (parseInt($('qAnswer').value, 10) || 1) - 1;
    spot.quiz = {
      question: $('qQuestion').value.trim(),
      choices: choices,
      answer: Math.max(0, Math.min(ans, choices.length - 1)),
      hint: $('qHint').value.trim(),
      explanation: $('qExplain').value.trim(),
    };
    saveDraft();
    renderSpotList();
    renderMarkers();
    toast('保存しました');
  }

  function deleteSpot() {
    const spot = course.spots.find((s) => s.id === activeId);
    if (!spot) return;
    if (!confirm('「' + spot.name + '」を削除しますか？')) return;
    course.spots = course.spots.filter((s) => s.id !== activeId);
    activeId = null;
    $('spotEditor').style.display = 'none';
    saveDraft();
    renderSpotList();
    renderMarkers();
  }

  /* ---------- 配布・保存 ---------- */
  function bindUI() {
    ['courseTitle', 'courseDesc', 'courseKeyword', 'courseKeywordHint', 'courseGoalText', 'courseContact']
      .forEach((id) => $(id).addEventListener('input', saveDraft));
    $('addSpotBtn').addEventListener('click', () => {
      const c = map.getCenter();
      addSpot(c.lat, c.lng);
    });
    $('saveSpotBtn').addEventListener('click', saveSpot);
    $('deleteSpotBtn').addEventListener('click', deleteSpot);

    $('shareBtn').addEventListener('click', () => {
      saveDraft();
      if (!course.spots.length) { toast('スポットを1つ以上追加してください'); return; }
      const link = Machi.buildShareLink(course);
      copyText(link);
      $('shareHint').innerHTML = '✅ 生徒用リンクをコピーしました。LINEやメールで配布してください。<br>' +
        '<a href="' + Machi.esc(link) + '" target="_blank" style="color:#1f7a5a;word-break:break-all;">リンクを開く</a>';
      toast('生徒用リンクをコピーしました');
    });

    $('previewBtn').addEventListener('click', () => {
      saveDraft();
      if (!course.spots.length) { toast('スポットを追加してください'); return; }
      window.open(Machi.buildShareLink(course), '_blank');
    });

    $('exportBtn').addEventListener('click', () => {
      saveDraft();
      const blob = new Blob([JSON.stringify(course, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = (course.title || 'course').replace(/\s+/g, '_') + '.json';
      a.click();
    });

    $('importInput').addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const data = JSON.parse(reader.result);
          const err = Machi.validateCourse(data);
          if (err) { toast(err); return; }
          course = data;
          if (!course.id) course.id = Machi.uid('course');
          $('courseTitle').value = course.title || '';
          $('courseDesc').value = course.description || '';
          $('courseKeyword').value = course.keyword || '';
          $('courseKeywordHint').value = course.keywordHint || '';
          $('courseGoalText').value = course.goalText || '';
          $('courseContact').value = course.contact || '';
          activeId = null;
          $('spotEditor').style.display = 'none';
          saveDraft();
          renderSpotList();
          renderMarkers();
          if (course.spots.length) map.fitBounds(L.latLngBounds(course.spots.map((s) => [s.lat, s.lng])), { padding: [50, 50] });
          toast('読み込みました');
        } catch (err) { toast('JSONの読み込みに失敗しました'); }
      };
      reader.readAsText(file);
      e.target.value = '';
    });
  }

  function copyText(text) {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
    } else { fallbackCopy(text); }
  }
  function fallbackCopy(text) {
    const ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } catch (e) {}
    document.body.removeChild(ta);
  }

  let toastTimer = null;
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
  }

  init();
})();
