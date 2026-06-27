/**
 * まちあるき学習アプリ — 回答受け取り＆先生用ダッシュボード（Google Apps Script）
 * ----------------------------------------------------------
 * 使い方は同じフォルダの SETUP.md を参照。
 * スプレッドシートに紐づけて「ウェブアプリ」としてデプロイ。
 *  - 生徒の「先生に送信」     → 「回答」シートに追記
 *  - チェックポイント到達/写真 → 「進捗」シートに追記（リアルタイム）
 *  - 先生用ダッシュボード      → URLの後ろに ?page=dash&key=合言葉 を付けて開く
 */

var SHEET_NAME = '回答';
var SHEET_LIVE = '進捗';
var TEACHER_KEY = 'shuri';   // ★先生用ダッシュボードの合言葉（好きな文字に変えてOK）
var WARN_MIN = 15;           // これ以上更新がないと 🟡
var ALERT_MIN = 30;          // これ以上更新がないと 🔴

var HEADERS = [
  '送信時刻', '名前', '学年', '班・チーム', 'コース',
  '到達', 'クイズ', 'キーワード', 'スポット詳細', 'メモ', '元データ(JSON)'
];
var LIVE_HEADERS = ['受信時刻', '班・チーム', '名前', 'コース', 'スポット', '状態', '緯度', '経度'];

function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    var ss = SpreadsheetApp.getActiveSpreadsheet();

    if (data.type === 'checkpoint') {
      var lv = ss.getSheetByName(SHEET_LIVE) || ss.insertSheet(SHEET_LIVE);
      if (lv.getLastRow() === 0) lv.appendRow(LIVE_HEADERS);
      lv.appendRow([
        new Date(), data.team || '', data.name || '', data.courseTitle || '',
        data.spot || '', data.state || '', data.lat || '', data.lng || ''
      ]);
    } else {
      var sh = ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);
      if (sh.getLastRow() === 0) sh.appendRow(HEADERS);
      sh.appendRow([
        data.ts || new Date(), data.name || '', data.grade || '', data.team || '',
        data.courseTitle || '', (data.done != null ? data.done + ' / ' + data.total : ''),
        (data.quizTotal ? (data.quizOk + ' / ' + data.quizTotal) : '-'),
        data.keyword || '-', data.spotsSummary || '', data.memos || '',
        JSON.stringify(data)
      ]);
    }
    return ContentService.createTextOutput(JSON.stringify({ ok: true })).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: String(err) })).setMimeType(ContentService.MimeType.JSON);
  }
}

function doGet(e) {
  if (e && e.parameter && e.parameter.page === 'dash') {
    if (String(e.parameter.key || '') !== TEACHER_KEY) {
      return HtmlService.createHtmlOutput('<p style="font-family:sans-serif;padding:24px;font-size:16px;">アクセスできません（合言葉がちがいます）。</p>');
    }
    return HtmlService.createHtmlOutput(buildDashboard())
      .addMetaTag('viewport', 'width=device-width, initial-scale=1')
      .setTitle('まちあるき 先生用ダッシュボード');
  }
  return ContentService.createTextOutput('まちあるき学習アプリ 回答受付：OK');
}

function esc_(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function grp_(title) {
  title = title || '';
  if (title.indexOf('ウォークラリー') >= 0) return 'am';
  if (title.indexOf('Aコース') >= 0) return 'a';
  if (title.indexOf('Bコース') >= 0) return 'b';
  if (title.indexOf('Cコース') >= 0) return 'c';
  return 'other';
}

function buildDashboard() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var tz = Session.getScriptTimeZone();
  var now = new Date();
  var ssUrl = ss.getUrl();

  // ---- ライブ進捗（進捗シート）----
  var live = ss.getSheetByName(SHEET_LIVE);
  var groups = {};
  if (live) {
    var v = live.getDataRange().getValues();
    for (var i = 1; i < v.length; i++) {
      var r = v[i];
      if (!r[0]) continue;
      var time = new Date(r[0]);
      var team = (r[1] || '(班なし)') + '';
      var name = r[2], course = r[3], spot = r[4], state = r[5];
      var g = groups[team];
      if (!g) g = groups[team] = { team: team, course: course, names: {}, spots: {}, last: time, lastSpot: spot, lastState: state };
      if (name) g.names[name] = true;
      if (spot) g.spots[spot] = true;
      if (course) g.course = course;
      if (time >= g.last) { g.last = time; g.lastSpot = spot; g.lastState = state; }
    }
  }
  var list = [];
  for (var k in groups) list.push(groups[k]);
  list.sort(function (a, b) { return (now - b.last) - (now - a.last); });
  var liveRows = '';
  list.forEach(function (g) {
    var mins = Math.floor((now - g.last) / 60000);
    var bg = mins >= ALERT_MIN ? '#fbeae9' : (mins >= WARN_MIN ? '#fff3d6' : '#e4f4ec');
    var st = mins >= ALERT_MIN ? '🔴 要確認' : (mins >= WARN_MIN ? '🟡 確認' : '🟢 順調');
    var hhmm = Utilities.formatDate(g.last, tz, 'HH:mm');
    liveRows += '<tr data-g="' + grp_(g.course) + '" style="background:' + bg + '">'
      + '<td><b>' + esc_(g.team) + '</b><div class="s">' + esc_(Object.keys(g.names).join('、')) + '</div></td>'
      + '<td>' + esc_(g.course || '') + '</td>'
      + '<td style="text-align:center;">' + Object.keys(g.spots).length + '</td>'
      + '<td>' + esc_(g.lastSpot || '') + '<div class="s">' + esc_(g.lastState || '') + '</div></td>'
      + '<td>' + hhmm + '<div class="s">' + mins + '分前</div></td>'
      + '<td>' + st + '</td></tr>';
  });
  if (!liveRows) liveRows = '<tr><td colspan="6" style="text-align:center;color:#888;padding:24px;">まだ送信がありません</td></tr>';

  // ---- 提出記録（回答シート）----
  var ans = ss.getSheetByName(SHEET_NAME);
  var ansRows = '', amCount = 0, pmCount = 0, total = 0;
  if (ans) {
    var a = ans.getDataRange().getValues();
    var arr = [];
    for (var j = 1; j < a.length; j++) { if (a[j][0]) arr.push(a[j]); }
    total = arr.length;
    arr.slice().reverse().forEach(function (r) {
      var gg = grp_(r[4]);
      if (gg === 'am') amCount++; else if (gg === 'a' || gg === 'b' || gg === 'c') pmCount++;
      var ts = (r[0] instanceof Date) ? Utilities.formatDate(r[0], tz, 'MM/dd HH:mm') : esc_(r[0]);
      ansRows += '<tr>'
        + '<td>' + ts + '</td>'
        + '<td><b>' + esc_(r[1]) + '</b></td>'
        + '<td>' + esc_(r[2]) + '</td>'
        + '<td>' + esc_(r[3]) + '</td>'
        + '<td>' + esc_(r[4]) + '</td>'
        + '<td style="text-align:center;">' + esc_(r[5]) + '</td>'
        + '<td style="text-align:center;">' + esc_(r[6]) + '</td>'
        + '<td>' + esc_(r[7]) + '</td></tr>';
    });
  }
  if (!ansRows) ansRows = '<tr><td colspan="8" style="text-align:center;color:#888;padding:24px;">まだ提出がありません</td></tr>';

  var nowStr = Utilities.formatDate(now, tz, 'HH:mm:ss');
  var css = '<style>'
    + 'body{font-family:-apple-system,"Hiragino Sans","Noto Sans JP",sans-serif;margin:0;background:#f5f6f4;color:#222;}'
    + 'h1{font-size:17px;background:#1f7a5a;color:#fff;margin:0;padding:12px 14px;}'
    + '.bar{padding:8px 14px;font-size:12px;color:#555;line-height:1.6;}'
    + '.tabs{display:flex;gap:6px;padding:8px 14px 0;}'
    + '.tabs button{flex:1;padding:10px;border:none;border-radius:10px 10px 0 0;background:#dde3df;font-weight:700;font-size:14px;cursor:pointer;}'
    + '.tabs button.on{background:#1f7a5a;color:#fff;}'
    + '.filters{padding:8px 14px;display:flex;gap:6px;flex-wrap:wrap;}'
    + '.filters button{padding:6px 12px;border:1px solid #1f7a5a;border-radius:999px;background:#fff;color:#1f7a5a;font-size:13px;font-weight:700;cursor:pointer;}'
    + '.filters button.on{background:#1f7a5a;color:#fff;}'
    + 'table{width:100%;border-collapse:collapse;font-size:14px;background:#fff;}'
    + 'th,td{padding:9px 10px;border-bottom:1px solid #e3e6e2;text-align:left;vertical-align:top;}'
    + 'th{background:#eef1ee;font-size:12px;}.s{font-size:12px;color:#666;margin-top:2px;}'
    + '.cnt{padding:8px 14px;font-size:13px;color:#333;}'
    + '.link{display:block;padding:14px;text-align:center;color:#1f7a5a;font-weight:700;}'
    + '</style>';

  return css
    + '<h1>🗺️ まちあるき 先生用ハブ</h1>'
    + '<div class="bar">最終更新 ' + nowStr + '（ライブ進捗は30秒ごとに自動更新）<br>🟢 順調 ／ 🟡 ' + WARN_MIN + '分更新なし ／ 🔴 ' + ALERT_MIN + '分更新なし（要確認）</div>'
    + '<div class="tabs"><button id="tabLive" class="on">📍 ライブ進捗</button><button id="tabAns">📔 提出記録</button></div>'
    + '<div id="secLive">'
    + '<div class="filters"><button data-f="all" class="on">全部</button><button data-f="am">午前</button><button data-f="a">Aコース</button><button data-f="b">Bコース</button><button data-f="c">Cコース</button></div>'
    + '<table id="liveTable"><thead><tr><th>班・メンバー</th><th>コース</th><th>通過</th><th>最新スポット</th><th>最終更新</th><th>状態</th></tr></thead><tbody>' + liveRows + '</tbody></table>'
    + '</div>'
    + '<div id="secAns" style="display:none;">'
    + '<div class="cnt">提出：合計 ' + total + ' 件（午前 ' + amCount + ' ／ 午後 ' + pmCount + '）</div>'
    + '<table><thead><tr><th>時刻</th><th>名前</th><th>学年</th><th>班</th><th>コース</th><th>到達</th><th>クイズ</th><th>キーワード</th></tr></thead><tbody>' + ansRows + '</tbody></table>'
    + '</div>'
    + '<a class="link" href="' + ssUrl + '" target="_blank">📊 スプレッドシートを開く（全データ）</a>'
    + '<script>(function(){'
    + 'var iv=30000;var timer=setInterval(function(){location.reload();},iv);'
    + 'function tab(t){document.getElementById("secLive").style.display=(t==="live")?"":"none";document.getElementById("secAns").style.display=(t==="ans")?"":"none";'
    + 'document.getElementById("tabLive").className=(t==="live")?"on":"";document.getElementById("tabAns").className=(t==="ans")?"on":"";'
    + 'clearInterval(timer);if(t==="live"){timer=setInterval(function(){location.reload();},iv);}}'
    + 'document.getElementById("tabLive").addEventListener("click",function(){tab("live");});'
    + 'document.getElementById("tabAns").addEventListener("click",function(){tab("ans");});'
    + 'var fb=document.querySelectorAll(".filters button");for(var i=0;i<fb.length;i++){fb[i].addEventListener("click",function(){'
    + 'var f=this.getAttribute("data-f");for(var j=0;j<fb.length;j++){fb[j].className=(fb[j]===this)?"on":"";}'
    + 'var rs=document.querySelectorAll("#liveTable tbody tr[data-g]");for(var m=0;m<rs.length;m++){rs[m].style.display=(f==="all"||rs[m].getAttribute("data-g")===f)?"":"none";}}.bind(fb[i]));}'
    + '})();<\/script>';
}
