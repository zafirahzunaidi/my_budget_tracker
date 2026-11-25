const LOG = 'Tracker Entries';
const HEADERS = ['ID', 'Date', 'Item', 'Type', 'Amount (RM)', 'Category', 'Account'];
const OPTIONS = {
  Expense: ['Dining Out', 'Groceries', 'Transport', 'Housing & Rent', 'Bills', 'Shopping', 'Other'],
  Income: ['Allowance', 'Salary', 'Freelance', 'Other']
};

// Run this in the editor once per spreadsheet copy.
function setup() {
  const book = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = book.getSheetByName(LOG);
  if (!sheet) sheet = book.insertSheet(LOG);
  if (!sheet.getLastRow()) {
    sheet.appendRow(HEADERS);
    sheet.setFrozenRows(1);
    sheet.getRange('A1:G1').setBackground('#665587').setFontColor('#ffffff');
    sheet.getRange('B:B').setNumberFormat('@');
    sheet.getRange('E2:E').setNumberFormat('"RM" #,##0.00');
  }
  checkHeader_(sheet);
  PropertiesService.getScriptProperties().setProperty('BOOK', book.getId());
}

function checkHeader_(sheet) {
  if (!sheet || JSON.stringify(sheet.getRange(1, 1, 1, HEADERS.length).getValues()[0]) !== JSON.stringify(HEADERS))
    throw new Error('Check the Tracker Entries tab and its original column headings.');
}

function doGet() {
  const page = HtmlService.createTemplateFromFile('Index');
  page.options = JSON.stringify(OPTIONS);
  page.today = Utilities.formatDate(new Date(), 'Asia/Kuala_Lumpur', 'yyyy-MM-dd');
  return page.evaluate().setTitle('My budget').addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function saveEntry(entry) {
  const amount = Number(entry.amount);
  if (!/^\d+(\.\d{1,2})?$/.test(entry.amount) || !(amount > 0 && amount <= 999999999))
    throw new Error('Enter a positive RM amount with up to two decimal places.');
  const date = new Date(entry.date + 'T12:00:00Z');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.date) || isNaN(date) || date.toISOString().slice(0,10) !== entry.date)
    throw new Error('Choose a valid date.');
  if (!Object.prototype.hasOwnProperty.call(OPTIONS, entry.type) || !OPTIONS[entry.type].includes(entry.category) ||
      !['Cash','Bank','TNG'].includes(entry.account) || !/^[a-f0-9-]{36}$/i.test(entry.id))
    throw new Error('Check your entry and try again.');
  const item = String(entry.item || '').trim().slice(0,160);
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const bookId = PropertiesService.getScriptProperties().getProperty('BOOK');
    if (!bookId) throw new Error('Run setup in the Apps Script editor first.');
    const sheet = SpreadsheetApp.openById(bookId).getSheetByName(LOG);
    checkHeader_(sheet);
    if (sheet.getRange('A:A').createTextFinder(entry.id).matchEntireCell(true).findNext()) return;
    sheet.appendRow([entry.id, entry.date, /^[=+@-]/.test(item) ? "'" + item : item,
      entry.type, amount, entry.category, entry.account]);
    SpreadsheetApp.flush();
  } finally { lock.releaseLock(); }
}
