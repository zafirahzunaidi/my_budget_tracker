// ============================================================
//  MY BUDGET — Google Apps Script backend
//  File: Code.gs
// ============================================================

const LOG      = 'Tracker Entries';
const SETTINGS = 'Settings';
const PLANS    = 'Plans';

const HEADERS       = ['ID', 'Date', 'Item', 'Type', 'Amount (RM)', 'Category', 'Account'];
const PLAN_HEADERS  = ['Month', 'TargetID', 'Name', 'TargetType', 'AmountType', 'AmountValue', 'Categories'];
// Month        : 'YYYY-MM'
// TargetID     : UUID (stable)
// Name         : free text
// TargetType   : 'Spending limit' | 'Savings goal'
// AmountType   : 'fixed' | 'percent'
// AmountValue  : number
// Categories   : pipe-separated list of expense categories, or '' for savings goals

const OPTIONS = {
  Expense: ['Dining Out', 'Groceries', 'Transport', 'Housing & Rent', 'Bills', 'Shopping', 'Other'],
  Income:  ['Allowance', 'Salary', 'Freelance', 'Other'],
  Savings: ['Savings']     // internal sub-type kept separate from Income/Expense
};

// ── Colour palette ─────────────────────────────────────────
const PLUM     = '#584674';

// ============================================================
//  SETUP  — safe to run more than once
// ============================================================
function setup() {
  const book = SpreadsheetApp.getActiveSpreadsheet();

  // ── Tracker Entries ──────────────────────────────────────
  let log = book.getSheetByName(LOG);
  if (!log) log = book.insertSheet(LOG);
  if (!log.getLastRow()) {
    log.appendRow(HEADERS);
    log.setFrozenRows(1);
    log.getRange('A1:G1').setBackground(PLUM).setFontColor('#ffffff');
    log.getRange('B:B').setNumberFormat('@');
    log.getRange('E2:E').setNumberFormat('"RM" #,##0.00');
  }
  checkHeader_(log);
  allocationColumn_(log);

  // ── Settings ──────────────────────────────────────────────
  let st = book.getSheetByName(SETTINGS);
  if (!st) {
    st = book.insertSheet(SETTINGS);
    st.appendRow(['Key', 'Value']);
    st.setFrozenRows(1);
    st.getRange('A1:B1').setBackground(PLUM).setFontColor('#ffffff');
  }

  // ── Plans ─────────────────────────────────────────────────
  let pl = book.getSheetByName(PLANS);
  if (!pl) {
    pl = book.insertSheet(PLANS);
    pl.appendRow(PLAN_HEADERS);
    pl.setFrozenRows(1);
    pl.getRange('A1:G1').setBackground(PLUM).setFontColor('#ffffff');
    pl.getRange('F:F').setNumberFormat('0.##');
  }

  PropertiesService.getScriptProperties().setProperty('BOOK', book.getId());
}

// ============================================================
//  INTERNAL HELPERS
// ============================================================
function checkHeader_(sheet) {
  const actual = sheet.getRange(1, 1, 1, HEADERS.length).getValues()[0];
  if (JSON.stringify(actual) !== JSON.stringify(HEADERS))
    throw new Error('Column headings in "' + LOG + '" do not match the expected format. Expected: ' + HEADERS.join(', '));
}

// Keep existing columns intact, including any columns the owner added by hand.
function allocationColumn_(sheet) {
  const last = sheet.getLastColumn();
  const label = 'Income for next month (RM)';
  const index = sheet.getRange(1, 1, 1, last).getValues()[0].indexOf(label);
  if (index >= 0) return index + 1;
  const column = last + 1;
  if (column > sheet.getMaxColumns()) sheet.insertColumnAfter(last);
  sheet.getRange(1, column).setValue(label);
  return column;
}

function nextAmount_(entry) {
  if (entry.type !== 'Income') return 0;
  const n = Number(entry.nextAmount || 0);
  if (!Number.isFinite(n) || n < 0 || n > Number(entry.amount) || Math.abs(n * 100 - Math.round(n * 100)) > 0.0001)
    throw new Error('The amount for next month must be between zero and the income received, in whole sen.');
  return n;
}

function validateEntry_(entry) {
  const date = new Date(entry.date + 'T12:00:00Z');
  if (isNaN(date) || date.toISOString().slice(0,10) !== entry.date) throw new Error('Choose a valid date.');
  if (!Object.keys(OPTIONS).includes(entry.type) || !/^[a-f0-9-]{36}$/i.test(entry.id)) throw new Error('Invalid transaction.');
  // Profiles can rename or retire options. Keep historical entries editable.
  for (const label of [entry.account, entry.category]) {
    if (typeof label !== 'string' || !label.trim() || label.length > 160) throw new Error('Choose an account and category.');
  }
  if (!/^\d+(\.\d{1,2})?$/.test(String(entry.amount)) || !(entry.amount > 0 && entry.amount <= 999999999))
    throw new Error('Enter a positive RM amount with up to two decimal places.');
  nextAmount_(entry);
}

function sheetLabel_(text) { return /^[=+@-]/.test(text) ? "'" + text : text; }

function getBook_() {
  const id = PropertiesService.getScriptProperties().getProperty('BOOK');
  if (!id) throw new Error('Run setup() in the Apps Script editor first, then redeploy.');
  return SpreadsheetApp.openById(id);
}

function normaliseDate_(raw) {
  if (!raw) return '';
  if (raw instanceof Date) return Utilities.formatDate(raw, 'Asia/Kuala_Lumpur', 'yyyy-MM-dd');
  const s = String(raw).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  if (!isNaN(d)) return Utilities.formatDate(d, 'Asia/Kuala_Lumpur', 'yyyy-MM-dd');
  return s;
}

// ============================================================
//  doGet
// ============================================================
function doGet() {
  const tpl = HtmlService.createTemplateFromFile('Index');
  tpl.options      = JSON.stringify(OPTIONS);
  tpl.today        = Utilities.formatDate(new Date(), 'Asia/Kuala_Lumpur', 'yyyy-MM-dd');
  tpl.isAppsScript = 'true';
  return tpl.evaluate()
            .setTitle('My Budget')
            .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// ============================================================
//  saveEntry
// ============================================================
function saveEntry(entry) {
  validateEntry_(entry);
  const amount = Number(entry.amount);
  const item = String(entry.item || '').trim().slice(0, 160);

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = getBook_().getSheetByName(LOG);
    checkHeader_(sheet);
    if (sheet.getRange('A:A').createTextFinder(entry.id).matchEntireCell(true).findNext()) return;
    const column = allocationColumn_(sheet);
    const values = [
      entry.id, entry.date,
      /^[=+@-]/.test(item) ? "'" + item : item,
      entry.type, amount, sheetLabel_(entry.category), sheetLabel_(entry.account)
    ];
    while (values.length < column - 1) values.push('');
    values.push(nextAmount_(entry));
    sheet.appendRow(values);
    SpreadsheetApp.flush();
  } finally { lock.releaseLock(); }
}

// ============================================================
//  updateEntry
// ============================================================
function updateEntry(entry) {
  validateEntry_(entry);
  const amount = Number(entry.amount);
  const item = String(entry.item || '').trim().slice(0, 160);
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = getBook_().getSheetByName(LOG);
    checkHeader_(sheet);
    const cell = sheet.getRange('A:A').createTextFinder(entry.id).matchEntireCell(true).findNext();
    if (!cell) throw new Error('Entry not found. It may have been deleted.');
    const row = cell.getRow();
    const column = allocationColumn_(sheet);
    const values = [
      entry.date, /^[=+@-]/.test(item) ? "'" + item : item,
      entry.type, amount, sheetLabel_(entry.category), sheetLabel_(entry.account)
    ];
    if (column === 8) {
      values.push(nextAmount_(entry));
      sheet.getRange(row, 2, 1, 7).setValues([values]);
    } else {
      sheet.getRange(row, 2, 1, 6).setValues([values]);
      sheet.getRange(row, column).setValue(nextAmount_(entry));
    }
    SpreadsheetApp.flush();
  } finally { lock.releaseLock(); }
}

// ============================================================
//  getTransactions
// ============================================================
function getTransactions() {
  const sheet = getBook_().getSheetByName(LOG);
  if (!sheet) return [];
  const last = sheet.getLastRow();
  if (last < 2) return [];
  const width = sheet.getLastColumn();
  const index = sheet.getRange(1, 1, 1, width).getValues()[0].indexOf('Income for next month (RM)');
  return sheet.getRange(2, 1, last - 1, width).getValues()
    .filter(r => r[0] && r[1])
    .map(r => ({
      id:       String(r[0]),
      date:     normaliseDate_(r[1]),
      item:     String(r[2] || '').replace(/^'/, ''),
      type:     String(r[3]),
      amount:   Number(r[4]) || 0,
      category: String(r[5]),
      account:  String(r[6]),
      nextAmount: Number(r[index]) || 0
    }));
}

// ============================================================
//  Plans
// ============================================================

/** Return all plan rows as plain objects, optionally filtered by month. */
function getPlans(month) {
  const book = getBook_();
  let pl = book.getSheetByName(PLANS);
  if (!pl) return [];
  const last = pl.getLastRow();
  if (last < 2) return [];
  const rows = pl.getRange(2, 1, last - 1, PLAN_HEADERS.length).getValues();
  const monthKey = v => v instanceof Date ? Utilities.formatDate(v, book.getSpreadsheetTimeZone(), 'yyyy-MM') : String(v).slice(0,7);
  return rows
    .filter(r => r[0] && r[1])
    .filter(r => !month || monthKey(r[0]) === month)
    .map(r => ({
      month:       monthKey(r[0]),
      targetId:    String(r[1]),
      name:        String(r[2]),
      targetType:  String(r[3]),
      amountType:  String(r[4]),
      amountValue: Number(r[5]) || 0,
      categories:  String(r[6])
    }));
}

/** Save or update a plan target.  match by targetId + month. */
function savePlan(plan) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try { writePlan_(plan); } finally { lock.releaseLock(); }
}

function writePlan_(plan) {
  if (!/^\d{4}-\d{2}$/.test(plan.month))     throw new Error('Invalid month.');
  if (!/^[a-f0-9-]{36}$/i.test(plan.targetId)) throw new Error('Invalid target ID.');
  if (!plan.name || String(plan.name).trim().length === 0) throw new Error('Enter a target name.');
  if (!['Spending limit','Savings goal'].includes(plan.targetType)) throw new Error('Invalid target type.');
  if (!['fixed','percent'].includes(plan.amountType)) throw new Error('Invalid amount type.');
  const val = Number(plan.amountValue);
  if (isNaN(val) || val <= 0) throw new Error('Enter a positive amount.');

  const book = getBook_();
  let pl = book.getSheetByName(PLANS);
  if (!pl) {
    pl = book.insertSheet(PLANS);
    pl.appendRow(PLAN_HEADERS);
    pl.setFrozenRows(1);
  }

  const cats = String(plan.categories || '').trim();
  const row  = [plan.month, plan.targetId, String(plan.name).trim().slice(0,80),
                plan.targetType, plan.amountType, val, cats];

  // Find existing row for this targetId
  const last = pl.getLastRow();
  if (last >= 2) {
    const col = pl.getRange(2, 2, last - 1, 1).getValues();
    for (let i = 0; i < col.length; i++) {
      if (String(col[i][0]) === plan.targetId) {
        pl.getRange(i + 2, 1).setNumberFormat('@');
        pl.getRange(i + 2, 1, 1, row.length).setValues([row]);
        SpreadsheetApp.flush();
        return;
      }
    }
  }
  pl.getRange(last + 1, 1).setNumberFormat('@');
  pl.getRange(last + 1, 1, 1, row.length).setValues([row]);
  SpreadsheetApp.flush();
}

/** Delete a plan target by targetId. */
function deletePlan(targetId) {
  const book = getBook_();
  const pl   = book.getSheetByName(PLANS);
  if (!pl) return;
  const last = pl.getLastRow();
  if (last < 2) return;
  const col = pl.getRange(2, 2, last - 1, 1).getValues();
  for (let i = col.length - 1; i >= 0; i--) {
    if (String(col[i][0]) === targetId) {
      pl.deleteRow(i + 2);
    }
  }
  SpreadsheetApp.flush();
}

/** Copy all plan targets from one month to another (skipping IDs that exist). */
function copyPlan(fromMonth, toMonth) {
  if (!/^\d{4}-\d{2}$/.test(fromMonth) || !/^\d{4}-\d{2}$/.test(toMonth))
    throw new Error('Invalid month format.');
  const existing = getPlans(toMonth).map(p => p.name.toLowerCase());
  const source   = getPlans(fromMonth);
  source.forEach(p => {
    if (existing.includes(p.name.toLowerCase())) return; // skip duplicates
    savePlan({
      month:       toMonth,
      targetId:    Utilities.getUuid(),
      name:        p.name,
      targetType:  p.targetType,
      amountType:  p.amountType,
      amountValue: p.amountValue,
      categories:  p.categories
    });
  });
}

// ============================================================
//  Settings
// ============================================================
function getSettings() {
  const book = getBook_();
  let st = book.getSheetByName(SETTINGS);
  if (!st) return {};
  const last = st.getLastRow();
  if (last < 2) return {};
  const rows = st.getRange(2, 1, last - 1, 2).getValues();
  const out = {};
  rows.forEach(([key, value]) => {
    if (!key) return;
    if (key === 'payday' || key === 'cycleStart') {
      out[key] = value instanceof Date ? Utilities.formatDate(value, book.getSpreadsheetTimeZone(), 'yyyy-MM-dd') : normaliseDate_(value);
    } else out[key] = String(value);
  });
  return out;
}

function saveSetting(key, value) { saveSettings({[key]: value}); }

function saveSettings(obj) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const book = getBook_();
    let sheet = book.getSheetByName(SETTINGS);
    if (!sheet) { sheet = book.insertSheet(SETTINGS); sheet.appendRow(['Key', 'Value']); }
    const settings = Object.assign(getSettings(), obj);
    const rows = Object.entries(settings).map(([key, value]) => [key, sheetLabel_(String(value))]);
    if (!rows.length) return;
    const range = sheet.getRange(2, 1, rows.length, 2);
    range.setNumberFormat('@');
    range.setValues(rows);
    const extra = sheet.getLastRow() - rows.length - 1;
    if (extra > 0) sheet.getRange(rows.length + 2, 1, extra, 2).clearContent();
    SpreadsheetApp.flush();
  } finally { lock.releaseLock(); }
}

// ============================================================
//  getAppData  — single boot call, never throws
// ============================================================
function getAppData() {
  var result = { transactions: [], settings: {}, plans: [], error: null };
  try { result.transactions = getTransactions(); } catch(e) { result.error = 'transactions: ' + e.message; }
  try { result.settings     = getSettings();     } catch(e) { result.error = (result.error||'') + ' settings: ' + e.message; }
  try { result.plans        = getPlans();        } catch(e) { result.error = (result.error||'') + ' plans: ' + e.message; }
  return result;
}

// ============================================================
//  deleteEntry  — remove a row by stable ID
// ============================================================
function deleteEntry(id) {
  if (!/^[a-f0-9-]{36}$/i.test(id)) throw new Error('Invalid entry ID.');
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = getBook_().getSheetByName(LOG);
    checkHeader_(sheet);
    const cell = sheet.getRange('A:A').createTextFinder(id).matchEntireCell(true).findNext();
    if (!cell) throw new Error('Entry not found. It may have already been deleted.');
    sheet.deleteRow(cell.getRow());
    SpreadsheetApp.flush();
  } finally { lock.releaseLock(); }
}
