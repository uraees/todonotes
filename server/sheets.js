/**
 * Google Sheets integration layer.
 *
 * Sheet schema (columns A–G):
 *   A: id          — UUID, primary key
 *   B: type        — "note" | "todo"
 *   C: content     — free-text content
 *   D: status      — "open" | "completed" | "deleted"
 *   E: due_date    — ISO date YYYY-MM-DD, or empty
 *   F: created_at  — ISO datetime
 *   G: updated_at  — ISO datetime
 *
 * Deleted items are soft-deleted (status = "deleted") and filtered out of reads.
 */

import { google } from 'googleapis';
import { v4 as uuidv4 } from 'uuid';

const HEADERS = ['id', 'type', 'content', 'status', 'due_date', 'created_at', 'updated_at'];

function sheetName() {
  return process.env.GOOGLE_SHEET_NAME || 'Sheet1';
}

function spreadsheetId() {
  return process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
}

function getAuth() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const rawKey = process.env.GOOGLE_PRIVATE_KEY;
  if (!email || !rawKey) {
    throw new Error(
      'Missing Google credentials. Set GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_PRIVATE_KEY in .env'
    );
  }
  // .env stores \n as literal \\n — restore actual newlines
  const key = rawKey.replace(/\\n/g, '\n');
  return new google.auth.JWT({
    email,
    key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
}

function getSheets() {
  return google.sheets({ version: 'v4', auth: getAuth() });
}

/** Ensure the header row exists. Idempotent. */
async function ensureHeaders() {
  const sheets = getSheets();
  const sid = spreadsheetId();
  let existing;
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: sid,
      range: `${sheetName()}!A1:G1`,
    });
    existing = res.data.values;
  } catch (err) {
    throw new Error(
      `Cannot read spreadsheet. Check GOOGLE_SHEETS_SPREADSHEET_ID and that the sheet tab is named "${sheetName()}". Details: ${err.message}`
    );
  }

  if (!existing || existing.length === 0 || existing[0][0] !== 'id') {
    await sheets.spreadsheets.values.update({
      spreadsheetId: sid,
      range: `${sheetName()}!A1:G1`,
      valueInputOption: 'RAW',
      requestBody: { values: [HEADERS] },
    });
  }
}

/** Return all non-deleted items as plain objects. */
async function getAllItems() {
  await ensureHeaders();
  const sheets = getSheets();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: spreadsheetId(),
    range: `${sheetName()}!A2:G`,
  });
  const rows = res.data.values || [];
  return rows
    .map((row) => ({
      id: row[0] || '',
      type: row[1] || 'todo',
      content: row[2] || '',
      status: row[3] || 'open',
      due_date: row[4] || null,
      created_at: row[5] || '',
      updated_at: row[6] || '',
    }))
    .filter((item) => item.id && item.status !== 'deleted');
}

/** Append a new item to the sheet. Returns the created item. */
async function createItem({ type = 'todo', content, due_date = null }) {
  await ensureHeaders();
  const now = new Date().toISOString();
  const id = uuidv4();
  const row = [id, type, content, 'open', due_date || '', now, now];
  await getSheets().spreadsheets.values.append({
    spreadsheetId: spreadsheetId(),
    range: `${sheetName()}!A:G`,
    valueInputOption: 'RAW',
    requestBody: { values: [row] },
  });
  return { id, type, content, status: 'open', due_date: due_date || null, created_at: now, updated_at: now };
}

/**
 * Find the 1-indexed row number for a given item ID.
 * Returns null if not found.
 */
async function findRowIndex(id) {
  const res = await getSheets().spreadsheets.values.get({
    spreadsheetId: spreadsheetId(),
    range: `${sheetName()}!A:A`,
  });
  const rows = res.data.values || [];
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === id) return i + 1; // 1-indexed; row 1 is header
  }
  return null;
}

/**
 * Update fields on an existing item.
 * @param {string} id
 * @param {{ type?, content?, status?, due_date? }} updates
 */
async function updateItem(id, updates) {
  const rowIndex = await findRowIndex(id);
  if (!rowIndex) throw new Error(`Item ${id} not found in sheet`);

  const sheets = getSheets();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: spreadsheetId(),
    range: `${sheetName()}!A${rowIndex}:G${rowIndex}`,
  });
  const current = res.data.values?.[0] || [];
  const now = new Date().toISOString();

  const newRow = [
    current[0],                                                          // id (immutable)
    updates.type    !== undefined ? updates.type    : current[1],        // type
    updates.content !== undefined ? updates.content : current[2],        // content
    updates.status  !== undefined ? updates.status  : current[3],        // status
    updates.due_date !== undefined ? (updates.due_date || '') : current[4], // due_date
    current[5],                                                          // created_at (immutable)
    now,                                                                 // updated_at
  ];

  await sheets.spreadsheets.values.update({
    spreadsheetId: spreadsheetId(),
    range: `${sheetName()}!A${rowIndex}:G${rowIndex}`,
    valueInputOption: 'RAW',
    requestBody: { values: [newRow] },
  });

  return {
    id,
    type: newRow[1],
    content: newRow[2],
    status: newRow[3],
    due_date: newRow[4] || null,
    created_at: newRow[5],
    updated_at: now,
  };
}

/** Soft-delete an item by setting its status to "deleted". */
async function deleteItem(id) {
  return updateItem(id, { status: 'deleted' });
}

/** Mark an item as completed. */
async function completeItem(id) {
  return updateItem(id, { status: 'completed' });
}

/** Reopen a completed item. */
async function reopenItem(id) {
  return updateItem(id, { status: 'open' });
}

export { getAllItems, createItem, updateItem, deleteItem, completeItem, reopenItem };
