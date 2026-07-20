/**
 * Planejamento HD — ponte de sincronização com o app (PWA)
 * ---------------------------------------------------------
 * COMO INSTALAR (uma vez só):
 * 1. Abra a planilha Planejamento_Tarefas_HD1_2025 no Google Sheets (no computador).
 * 2. Menu Extensões → Apps Script.
 * 3. Apague o conteúdo do editor e cole ESTE arquivo inteiro. Salve (Ctrl+S).
 * 4. Botão azul "Implantar" → "Nova implantação" → tipo "App da Web".
 *      - Executar como: Eu (você)
 *      - Quem pode acessar: Qualquer pessoa
 * 5. Autorize quando pedir. Copie a URL que termina em /exec.
 * 6. No app, botão de sincronizar (canto superior direito) → cole a URL.
 *
 * O QUE ELE FAZ:
 *  - pull: lê as tarefas (aba Tarefas, a partir da linha 13) e os projetos → manda para o app.
 *  - push: recebe as tarefas do app e reescreve SOMENTE as colunas de valores
 *          (A, E, F, G, H, I, K, M, N, O, P, Q, R). As colunas de fórmula
 *          (B, C, D, J, L, S, T, U, V) são preenchidas copiando a fórmula da linha 13,
 *          então o Gantt, o Status e a formatação da planilha continuam funcionando.
 *  - Linhas com % automático (autoPct) recebem de volta a FÓRMULA de % em K,
 *    exatamente como na planilha original.
 *  - Antes de cada push é criada uma aba oculta de backup com data/hora
 *    (Tarefas_bk_...); os 3 backups mais recentes são mantidos.
 *
 * IMPORTANTE ao atualizar este código: salvar NÃO basta. É preciso
 * Implantar → Gerenciar implantações → ✎ → Versão: "Nova versão" → Implantar.
 * Para conferir a versão ativa, abra a URL /exec no navegador (mostra "version").
 */

var SHEET_TAREFAS = 'Tarefas';
var SHEET_PROJETOS = 'Projetos';
var FIRST_ROW = 13;            // primeira linha de dados na aba Tarefas
var TZ = Session.getScriptTimeZone();

function doPost(e) {
  var out;
  try {
    var body = JSON.parse(e.postData.contents);
    if (body.action === 'pull') out = doPull();
    else if (body.action === 'push') out = doPush(body.tasks || []);
    else out = { error: 'ação desconhecida' };
  } catch (err) {
    out = { error: String(err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out))
    .setMimeType(ContentService.MimeType.JSON);
}
var SCRIPT_VERSION = 'v5';  // abra a URL /exec no navegador para conferir a versão ativa

function doGet(e) {
  /* Diagnóstico: abra  <URL>/exec?diag=182  para inspecionar a linha 182 */
  if (e && e.parameter && e.parameter.diag) {
    var row = Number(e.parameter.diag);
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var ws = ss.getSheetByName(SHEET_TAREFAS);
    var k = ws.getRange(row, 11), l = ws.getRange(row, 12);
    var out = {
      version: SCRIPT_VERSION,
      spreadsheetLocale: ss.getSpreadsheetLocale(),
      lastDataRow: lastDataRow(ws),
      lastPush: PropertiesService.getScriptProperties().getProperty('lastPush') || 'nunca',
      K: { formula: k.getFormula(), value: String(k.getValue()), numberFormat: k.getNumberFormat() },
      L: { formula: l.getFormula(), value: String(l.getValue()), numberFormat: l.getNumberFormat() },
      A: String(ws.getRange(row, 1).getValue())
    };
    return ContentService.createTextOutput(JSON.stringify(out, null, 1))
      .setMimeType(ContentService.MimeType.JSON);
  }
  return ContentService.createTextOutput(JSON.stringify({ ok: true, version: SCRIPT_VERSION, msg: 'Planejamento HD sync ativo' }))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ---------------- helpers ---------------- */
function isoDate(v) {
  if (v instanceof Date && !isNaN(v)) return Utilities.formatDate(v, TZ, 'yyyy-MM-dd');
  if (typeof v === 'string' && v.trim()) return v.trim();
  return null;
}
function toDate(isoStr) {
  if (!isoStr) return '';
  var p = String(isoStr).split('-');
  return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
}
/* Escreve uma coluna misturando valores e fórmulas.
   Valores em lote via setValues; fórmulas em trechos contíguos via setFormulas
   (garante que a planilha as receba como fórmula de verdade, nunca como texto). */
function writeMixedColumn(ws, col, arr) {
  var n = arr.length;
  ws.getRange(FIRST_ROW, col, n, 1).setValues(arr.map(function (x) { return [x.f ? '' : x.v]; }));
  var start = -1, run = [];
  for (var i = 0; i <= n; i++) {
    var isF = (i < n) && arr[i].f;
    if (isF) { if (start < 0) start = i; run.push([arr[i].f]); }
    else if (start >= 0) {
      ws.getRange(FIRST_ROW + start, col, run.length, 1).setFormulas(run);
      start = -1; run = [];
    }
  }
}

function lastDataRow(ws) {
  var vals = ws.getRange(FIRST_ROW, 1, ws.getMaxRows() - FIRST_ROW + 1, 1).getValues();
  var last = FIRST_ROW - 1;
  for (var i = 0; i < vals.length; i++) if (String(vals[i][0]).trim() !== '') last = FIRST_ROW + i;
  return last;
}

/* ---------------- PULL ---------------- */
function doPull() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ws = ss.getSheetByName(SHEET_TAREFAS);
  var last = lastDataRow(ws);
  var tasks = [];
  if (last >= FIRST_ROW) {
    var n = last - FIRST_ROW + 1;
    var vals = ws.getRange(FIRST_ROW, 1, n, 18).getValues();      // A:R
    var kForms = ws.getRange(FIRST_ROW, 11, n, 1).getFormulas();  // K
    var lForms = ws.getRange(FIRST_ROW, 12, n, 1).getFormulas();  // L (status)
    var lVals  = ws.getRange(FIRST_ROW, 12, n, 1).getValues();
    for (var i = 0; i < n; i++) {
      var r = vals[i];
      if (String(r[0]).trim() === '') continue;
      var autoPct = kForms[i][0] !== '';
      /* status digitado por cima da fórmula → manual */
      var statusManual = (lForms[i][0] === '' && String(lVals[i][0]).trim() !== '')
        ? String(lVals[i][0]).trim() : null;
      var pct = (typeof r[10] === 'number') ? Math.round(r[10] * 10000) / 10000 : 0;
      tasks.push({
        projId: String(r[0]).trim(),
        tarefa: r[4] === '' ? '' : String(r[4]),
        obs: r[5] === '' ? null : String(r[5]),
        conclusao: isoDate(r[6]),
        inicio: isoDate(r[7]),
        esforco: (typeof r[8] === 'number') ? r[8] : null,
        pct: pct,
        autoPct: autoPct,
        statusManual: statusManual,
        resp: r[12] === '' ? null : String(r[12]),
        precisao: r[13] === 'Exato' ? 'Exata' : (r[13] === '' ? null : String(r[13])),
        interessado: r[14] === '' ? null : String(r[14]),
        inicioReal: isoDate(r[15]),
        esforcoReal: (typeof r[16] === 'number') ? r[16] : null,
        fimReal: isoDate(r[17])
      });
    }
  }
  var projects = [];
  var wp = ss.getSheetByName(SHEET_PROJETOS);
  if (wp) {
    var pv = wp.getRange(2, 1, Math.max(wp.getLastRow() - 1, 1), 7).getValues();
    for (var j = 0; j < pv.length; j++) {
      if (String(pv[j][0]).trim() === '') continue;
      projects.push({
        id: String(pv[j][0]).trim(), nome: String(pv[j][1] || ''), local: String(pv[j][2] || ''),
        categoria: String(pv[j][3] || ''), prioridade: String(pv[j][5] || ''), resp: String(pv[j][6] || '')
      });
    }
  }
  return { tasks: tasks, projects: projects };
}

/* ---------------- PUSH ---------------- */
function doPush(tasks) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ws = ss.getSheetByName(SHEET_TAREFAS);

  /* backup de segurança com data/hora — mantém os 3 mais recentes */
  var BK_PREFIX = 'Tarefas_bk_';
  var stamp = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd_HH-mm-ss');
  ws.copyTo(ss).setName(BK_PREFIX + stamp).hideSheet();
  var bks = ss.getSheets()
    .filter(function (s) { return s.getName().indexOf(BK_PREFIX) === 0; })
    .sort(function (a, b) { return a.getName() < b.getName() ? -1 : 1; });
  while (bks.length > 3) ss.deleteSheet(bks.shift());
  var legacy = ss.getSheetByName('Tarefas_backup');   // backup do formato antigo
  if (legacy) ss.deleteSheet(legacy);

  var prevLast = lastDataRow(ws);
  var n = tasks.length;
  var endRow = FIRST_ROW + n - 1;

  /* fórmula de % automático (mesma da planilha original), por linha */
  function kFormula(row) {
    return '=IF(H' + row + '="",0, IF(TODAY() <= H' + row + ', 0, IF(TODAY() >=J' + row +
           ', "Verificar", (TODAY() - H' + row + ') / (J' + row + ' - H' + row + ') * 1)))';
  }

  if (n > 0) {
    /* valores: A | E F G H I | K | M N O P Q R  (G/H = datas; K = número ou fórmula) */
    var colA = [], colEI = [], colMR = [];
    for (var i = 0; i < n; i++) {
      var t = tasks[i];
      colA.push([t.projId || '']);
      colEI.push([t.tarefa || '', t.obs || '', toDate(t.conclusao), toDate(t.inicio),
                  (t.esforco === null || t.esforco === undefined) ? '' : t.esforco]);
      colMR.push([t.resp || '', t.precisao || '', t.interessado || '',
                  toDate(t.inicioReal),
                  (t.esforcoReal === null || t.esforcoReal === undefined) ? '' : t.esforcoReal,
                  toDate(t.fimReal)]);
    }
    ws.getRange(FIRST_ROW, 1, n, 1).setValues(colA);   // A
    ws.getRange(FIRST_ROW, 5, n, 5).setValues(colEI);  // E:I
    ws.getRange(FIRST_ROW, 13, n, 6).setValues(colMR); // M:R

    /* fórmula de status (coluna L), mesma da planilha original */
    function lFormula(row) {
      return '=IF(AND(K' + row + '=0,H' + row + '>=TODAY()),"Não iniciado", IF(K' + row +
             '=1,"Concluído",IF(K' + row + '=0,"Standby",IF(OR(AND(K' + row + '=0,H' + row +
             '<=TODAY()),J' + row + '<TODAY()),"Atrasado",IF(AND(H' + row + '="",H' + row +
             '<>"",H' + row + '<=TODAY()),"Atrasado","Em andamento")))))';
    }

    /* K e L: fórmula por padrão; valor digitado quando houver edição manual no app.
       Fórmulas gravadas com setFormulas (API do Google, sintaxe com vírgulas);
       na planilha elas APARECEM com ";" conforme o idioma pt-BR. */
    var kOut = [], lOut = [];
    for (var r = 0; r < n; r++) {
      var row = FIRST_ROW + r;
      kOut.push(tasks[r].autoPct ? { f: kFormula(row) } : { v: (tasks[r].pct || 0) });
      lOut.push(tasks[r].statusManual ? { v: tasks[r].statusManual } : { f: lFormula(row) });
    }
    /* Células que um dia receberam a fórmula como texto ficaram com formato
       "Texto simples" — nesse formato, até setFormulas vira literal na tela.
       Forçar o formato numérico ANTES de gravar resolve de vez. */
    ws.getRange(FIRST_ROW, 11, n, 1).setNumberFormat('0%');       // K
    ws.getRange(FIRST_ROW, 12, n, 1).setNumberFormat('General');  // L
    writeMixedColumn(ws, 11, kOut);
    writeMixedColumn(ws, 12, lOut);

    /* colunas de fórmula copiadas da linha-modelo 13 para todas as linhas */
    var formulaCols = [2, 3, 4, 10, 19, 20, 21, 22]; // B C D J S T U V
    for (var f = 0; f < formulaCols.length; f++) {
      var c = formulaCols[f];
      var src = ws.getRange(FIRST_ROW, c);
      if (src.getFormula() === '') continue;
      if (n > 1) src.copyTo(ws.getRange(FIRST_ROW + 1, c, n - 1, 1), { contentsOnly: false });
    }
  }

  /* limpa linhas que sobraram (sem apagar linhas, para não quebrar a formatação condicional) */
  if (prevLast > endRow) {
    var extra = prevLast - Math.max(endRow, FIRST_ROW - 1);
    ws.getRange(Math.max(endRow + 1, FIRST_ROW), 1, extra, 1).clearContent();               // A
    ws.getRange(Math.max(endRow + 1, FIRST_ROW), 5, extra, 5).clearContent();               // E:I
    ws.getRange(Math.max(endRow + 1, FIRST_ROW), 11, extra, 1).clearContent();              // K
    ws.getRange(Math.max(endRow + 1, FIRST_ROW), 13, extra, 6).clearContent();              // M:R
    ws.getRange(Math.max(endRow + 1, FIRST_ROW), 2, extra, 3).clearContent();               // B:D
    ws.getRange(Math.max(endRow + 1, FIRST_ROW), 10, extra, 1).clearContent();              // J
    ws.getRange(Math.max(endRow + 1, FIRST_ROW), 12, extra, 1).clearContent();              // L
    ws.getRange(Math.max(endRow + 1, FIRST_ROW), 19, extra, 4).clearContent();              // S:V
  }

  PropertiesService.getScriptProperties().setProperty('lastPush', JSON.stringify({
    quando: new Date().toISOString(), tarefas: n, scriptVersion: SCRIPT_VERSION
  }));
  return { ok: true, written: n, scriptVersion: SCRIPT_VERSION };
}
