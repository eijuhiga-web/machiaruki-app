/* ============================================================
   まちあるき学習アプリ - 共通モジュール (common.js)
   - コースの読み込み / 共有リンクの生成・解析
   - 生徒の記録（進捗・メモ・クイズ）の保存
   - 写真の保存（IndexedDB）
   - 距離計算など
   ============================================================ */
(function (global) {
  'use strict';

  const Machi = {};

  /* ---------- 距離計算（ハバーサイン / 単位:メートル） ---------- */
  Machi.distanceMeters = function (lat1, lng1, lat2, lng2) {
    const R = 6371000;
    const toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  };

  /* ---------- ID生成 ---------- */
  Machi.uid = function (prefix) {
    return (prefix || 'id') + '-' + Math.floor(performance.now() * 1000).toString(36) +
      '-' + (Machi._seq = (Machi._seq || 0) + 1).toString(36);
  };

  /* ---------- 空のコース ---------- */
  Machi.emptyCourse = function () {
    return {
      id: Machi.uid('course'),
      title: '新しいまちあるきコース',
      description: '',
      spots: [],
    };
  };

  /* ---------- コースの検証（最低限） ---------- */
  Machi.validateCourse = function (c) {
    if (!c || typeof c !== 'object') return 'コースデータが不正です。';
    if (!Array.isArray(c.spots)) return 'spots がありません。';
    return null;
  };

  /* ---------- 共有リンク用 エンコード/デコード ---------- */
  // LZString が読み込まれていれば圧縮、なければ素のbase64
  Machi.encodeCourse = function (course) {
    const json = JSON.stringify(course);
    if (global.LZString) {
      return 'lz:' + LZString.compressToEncodedURIComponent(json);
    }
    return 'b64:' + Machi._b64encode(json);
  };

  Machi.decodeCourse = function (str) {
    try {
      if (str.startsWith('lz:') && global.LZString) {
        const json = LZString.decompressFromEncodedURIComponent(str.slice(3));
        return JSON.parse(json);
      }
      if (str.startsWith('b64:')) {
        return JSON.parse(Machi._b64decode(str.slice(4)));
      }
      // 接頭辞なし＝旧形式 lz
      if (global.LZString) {
        const json = LZString.decompressFromEncodedURIComponent(str);
        if (json) return JSON.parse(json);
      }
      return JSON.parse(Machi._b64decode(str));
    } catch (e) {
      console.error('decodeCourse 失敗', e);
      return null;
    }
  };

  // UTF-8 対応 base64
  Machi._b64encode = function (str) {
    return btoa(unescape(encodeURIComponent(str)));
  };
  Machi._b64decode = function (b64) {
    return decodeURIComponent(escape(atob(b64)));
  };

  /* ---------- URLからコースを取得 ----------
     優先順位:
       1) #c=<encoded>      … 共有リンク（コースを丸ごと埋め込み）
       2) ?course=<id>      … courses/<id>.json を取得
       3) localStorage の下書き（editorからのプレビュー）
  */
  Machi.getCourseFromURL = async function () {
    const hash = global.location.hash || '';
    const m = hash.match(/[#&]c=([^&]+)/);
    if (m) {
      const c = Machi.decodeCourse(decodeURIComponent(m[1]));
      if (c) return c;
    }
    const params = new URLSearchParams(global.location.search);
    const id = params.get('course');
    if (id) {
      try {
        const res = await fetch('courses/' + id + '.json');
        if (res.ok) return await res.json();
      } catch (e) {
        console.warn('コースJSONの取得に失敗', e);
      }
    }
    // ホーム画面から起動した時など、URLにコースが無ければ前回のコースを再開
    try {
      const last = localStorage.getItem('machi:lastCourse');
      if (last) return JSON.parse(last);
    } catch (e) {}
    return null;
  };

  Machi.saveLastCourse = function (course) {
    try { localStorage.setItem('machi:lastCourse', JSON.stringify(course)); } catch (e) {}
  };

  // 2点間の方位角（度・北=0、時計回り）
  Machi.bearing = function (lat1, lng1, lat2, lng2) {
    const toRad = (d) => (d * Math.PI) / 180;
    const y = Math.sin(toRad(lng2 - lng1)) * Math.cos(toRad(lat2));
    const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
      Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(toRad(lng2 - lng1));
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  };

  Machi.buildShareLink = function (course) {
    const base =
      global.location.origin +
      global.location.pathname.replace(/editor\.html$/, 'index.html');
    return base + '#c=' + encodeURIComponent(Machi.encodeCourse(course));
  };

  /* ====================================================
     生徒の記録（進捗・メモ・クイズ）= localStorage
     キー: machi:progress:<courseId>
     形: { spots: { <spotId>: {arrived, memo, quizAnswer, quizCorrect, photoKeys:[]} } }
     ==================================================== */
  Machi.progressKey = function (courseId) {
    return 'machi:progress:' + courseId;
  };

  Machi.loadProgress = function (courseId) {
    try {
      const raw = localStorage.getItem(Machi.progressKey(courseId));
      return raw ? JSON.parse(raw) : { spots: {} };
    } catch (e) {
      return { spots: {} };
    }
  };

  Machi.saveProgress = function (courseId, progress) {
    localStorage.setItem(Machi.progressKey(courseId), JSON.stringify(progress));
  };

  Machi.getSpotProgress = function (progress, spotId) {
    if (!progress.spots[spotId]) {
      progress.spots[spotId] = { arrived: false, memo: '', quizAnswer: null, quizCorrect: null, attempts: 0, photoKeys: [] };
    }
    return progress.spots[spotId];
  };

  Machi.hasQuiz = function (spot) {
    return !!(spot && spot.quiz && spot.quiz.question);
  };

  // ミッション/スポットが「クリア」かどうか
  //  - クイズあり: 正解したらクリア
  //  - クイズなし: GPS到着でクリア
  Machi.isSpotComplete = function (spot, sp) {
    if (Machi.hasQuiz(spot)) return sp.quizCorrect === true;
    return sp.arrived === true;
  };

  // 集めた文字（コースのキーワード機能）
  Machi.collectedLetters = function (course, progress) {
    return course.spots.map(function (spot) {
      if (!spot.collectLetter) return null;
      const sp = Machi.getSpotProgress(progress, spot.id);
      return Machi.isSpotComplete(spot, sp) ? spot.collectLetter : null;
    });
  };

  /* ====================================================
     写真の保存 = IndexedDB（localStorageは小さいので別管理）
     ==================================================== */
  const DB_NAME = 'machi-photos';
  const STORE = 'photos';
  let _dbPromise = null;

  function openDB() {
    if (_dbPromise) return _dbPromise;
    _dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return _dbPromise;
  }

  Machi.savePhoto = async function (key, dataUrl) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(dataUrl, key);
      tx.oncomplete = () => resolve(key);
      tx.onerror = () => reject(tx.error);
    });
  };

  Machi.getPhoto = async function (key) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  };

  Machi.deletePhoto = async function (key) {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  };

  /* ---------- 画像をリサイズ・圧縮して dataURL を返す ---------- */
  Machi.compressImage = function (file, maxSize, quality) {
    maxSize = maxSize || 1000;
    quality = quality || 0.7;
    return new Promise((resolve, reject) => {
      const img = new Image();
      const reader = new FileReader();
      reader.onload = () => { img.src = reader.result; };
      reader.onerror = reject;
      img.onload = () => {
        let { width, height } = img;
        if (width > height && width > maxSize) {
          height = Math.round((height * maxSize) / width);
          width = maxSize;
        } else if (height > maxSize) {
          width = Math.round((width * maxSize) / height);
          height = maxSize;
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  /* ---------- HTMLエスケープ ---------- */
  Machi.esc = function (s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  };

  /* ====================================================
     せってい（音・文字サイズ）
     ==================================================== */
  Machi.settings = {
    get sound() { return localStorage.getItem('machi:sound') !== 'off'; },
    set sound(v) { localStorage.setItem('machi:sound', v ? 'on' : 'off'); },
    get font() { return localStorage.getItem('machi:font') || 'normal'; },
    set font(v) { localStorage.setItem('machi:font', v); },
  };

  /* ====================================================
     効果音（WebAudioで合成＝音声ファイル不要・オフラインOK）
     ==================================================== */
  let _ac = null;
  function ac() {
    if (!_ac) { try { _ac = new (global.AudioContext || global.webkitAudioContext)(); } catch (e) {} }
    if (_ac && _ac.state === 'suspended') _ac.resume();
    return _ac;
  }
  function tone(freq, start, dur, type, gain) {
    const a = ac(); if (!a) return;
    const o = a.createOscillator(), g = a.createGain();
    o.type = type || 'sine'; o.frequency.value = freq;
    o.connect(g); g.connect(a.destination);
    const t = a.currentTime + start;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain || 0.18, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.start(t); o.stop(t + dur + 0.02);
  }
  Machi.sound = function (name) {
    if (!Machi.settings.sound) return;
    if (name === 'correct' || name === 'arrive') {
      tone(660, 0, 0.14, 'triangle'); tone(880, 0.12, 0.18, 'triangle');
    } else if (name === 'goal') {
      [523, 659, 784, 1046].forEach((f, i) => tone(f, i * 0.13, 0.22, 'triangle', 0.2));
    } else if (name === 'wrong') {
      tone(220, 0, 0.18, 'sawtooth', 0.12);
    } else if (name === 'tap') {
      tone(520, 0, 0.06, 'sine', 0.08);
    }
  };
  Machi.vibrate = function (pattern) {
    if (Machi.settings.sound && global.navigator && navigator.vibrate) {
      try { navigator.vibrate(pattern); } catch (e) {}
    }
  };

  /* ====================================================
     紙吹雪（自前canvas＝ライブラリ不要・オフラインOK）
     ==================================================== */
  Machi.confetti = function (opts) {
    opts = opts || {};
    const canvas = document.getElementById('fxCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width = global.innerWidth;
    const H = canvas.height = global.innerHeight;
    const colors = ['#f0a500', '#d8402e', '#1f7a5a', '#2a9d76', '#ffd34d', '#4da3ff', '#ff7eb6'];
    const N = opts.count || 140;
    const parts = [];
    for (let i = 0; i < N; i++) {
      parts.push({
        x: W / 2 + (Math.random() - 0.5) * W * 0.5,
        y: H * 0.35 + (Math.random() - 0.5) * 60,
        vx: (Math.random() - 0.5) * 9,
        vy: Math.random() * -9 - 4,
        g: 0.22 + Math.random() * 0.1,
        s: 6 + Math.random() * 7,
        rot: Math.random() * 6.28,
        vr: (Math.random() - 0.5) * 0.3,
        c: colors[(Math.random() * colors.length) | 0],
        life: 0,
      });
    }
    let frame = 0;
    function step() {
      ctx.clearRect(0, 0, W, H);
      frame++;
      let alive = false;
      parts.forEach((p) => {
        p.vy += p.g; p.x += p.vx; p.y += p.vy; p.rot += p.vr; p.vx *= 0.99;
        if (p.y < H + 20) alive = true;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
        ctx.fillStyle = p.c; ctx.globalAlpha = Math.max(0, 1 - frame / 130);
        ctx.fillRect(-p.s / 2, -p.s / 2, p.s, p.s * 0.6);
        ctx.restore();
      });
      if (alive && frame < 140) requestAnimationFrame(step);
      else ctx.clearRect(0, 0, W, H);
    }
    step();
  };

  global.Machi = Machi;
})(window);
