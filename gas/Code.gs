/**
 * まちあるき学習アプリ — 回答受け取り用 Google Apps Script
 * ----------------------------------------------------------
 * 使い方は同じフォルダの SETUP.md を参照。
 * このスクリプトを「Googleスプレッドシート」に紐づけて、
 * 「ウェブアプリ」としてデプロイすると、生徒の回答がシートに追記されます。
 */

var SHEET_NAME = '回答';
var HEADERS = [
  '送信時刻', '名前', '学年', '班・チーム', 'コース',
  '到達', 'クイズ', 'キーワード', 'スポット詳細', 'メモ', '元データ(JSON)'
];

function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sh = ss.getSheetByName(SHEET_NAME);
    if (!sh) sh = ss.insertSheet(SHEET_NAME);
    if (sh.getLastRow() === 0) sh.appendRow(HEADERS);

    sh.appendRow([
      data.ts || new Date(),
      data.name || '',
      data.grade || '',
      data.team || '',
      data.courseTitle || '',
      (data.done != null ? data.done + ' / ' + data.total : ''),
      (data.quizTotal ? (data.quizOk + ' / ' + data.quizTotal) : '-'),
      data.keyword || '-',
      data.spotsSummary || '',
      data.memos || '',
      JSON.stringify(data)
    ]);

    return ContentService
      .createTextOutput(JSON.stringify({ ok: true }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: String(err) }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function doGet() {
  return ContentService.createTextOutput('まちあるき学習アプリ 回答受付：OK');
}
