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
    return null;
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

  global.Machi = Machi;
})(window);
