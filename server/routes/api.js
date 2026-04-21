/**
 * API route handlers.
 *
 * Routes:
 *   GET  /api/items              — fetch all non-deleted items
 *   POST /api/command            — parse NLP command and execute action
 *   DELETE /api/items/:id        — direct delete (UI trash icon)
 *   PATCH  /api/items/:id/complete  — direct complete toggle
 *   PATCH  /api/items/:id/reopen    — reopen a completed item
 */

import express from 'express';
import {
  getAllItems,
  createItem,
  updateItem,
  deleteItem,
  completeItem,
  reopenItem,
} from '../sheets.js';
import { parseCommand } from '../parser.js';
import {
  clearSessionCookie,
  isAuthEnabled,
  isAuthenticated,
  requireAuth,
  setSessionCookie,
  verifyCode,
} from '../auth.js';

const router = express.Router();

// ─── Date helpers (server-side) ──────────────────────────────────────────────

function todayStr() {
  return new Date().toISOString().split('T')[0];
}

function offsetDate(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

function endOfWeekStr() {
  const d = new Date();
  // (7 - day) % 7 gives 0 on Sunday (end of week = today), 1 on Saturday, etc.
  const daysUntilSunday = (7 - d.getDay()) % 7;
  d.setDate(d.getDate() + daysUntilSunday);
  return d.toISOString().split('T')[0];
}

function formatDateHuman(isoDate) {
  if (!isoDate) return '';
  const date = new Date(isoDate + 'T00:00:00');
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

// ─── Fuzzy item matcher ──────────────────────────────────────────────────────

/**
 * Given a natural language description, score all items and return the best match.
 * Returns null if nothing scores above zero.
 *
 * Scoring:
 *   +5 for exact phrase match
 *   +1 per keyword that appears in content
 *
 * Stop-words and short filler words are stripped from the keyword list.
 */
function findBestMatch(items, description, itemType) {
  if (!description) return null;

  const STOP = new Set([
    'the', 'that', 'this', 'with', 'about', 'note', 'todo', 'task',
    'item', 'reminder', 'and', 'for', 'from', 'a', 'an', 'to', 'of',
    'on', 'in', 'at', 'my', 'me', 'it', 'its', 'was', 'were', 'are',
    'is', 'be', 'been', 'have', 'has', 'had', 'do', 'did', 'does',
    'originally', 'requested', 'called', 'named',
  ]);

  const normalized = description.toLowerCase();
  const keywords = normalized
    .split(/\W+/)
    .filter((w) => w.length > 2 && !STOP.has(w));

  // If no useful keywords survive, fall back to all non-stop words ≥ 2 chars
  const effectiveKeywords = keywords.length > 0
    ? keywords
    : normalized.split(/\W+/).filter((w) => w.length > 2);

  let best = null;
  let bestScore = 0;

  for (const item of items) {
    if (item.status === 'deleted') continue;
    // Type filter: respect item_type when it's specific
    if (itemType && itemType !== 'any' && item.type !== itemType) continue;

    const content = item.content.toLowerCase();
    let score = 0;

    if (content.includes(normalized)) score += 5;
    for (const kw of effectiveKeywords) {
      if (content.includes(kw)) score += 1;
    }

    if (score > bestScore) {
      bestScore = score;
      best = item;
    }
  }

  return bestScore > 0 ? best : null;
}

// ─── Query filter ─────────────────────────────────────────────────────────────

function filterByQuery(items, queryType, itemType) {
  const today = todayStr();
  const tomorrow = offsetDate(1);
  const endWeek = endOfWeekStr();

  let result = [...items];

  // Item type filter
  if (itemType && itemType !== 'any') {
    result = result.filter((i) => i.type === itemType);
  }

  switch (queryType) {
    case 'overdue':
      return result.filter((i) => i.due_date && i.due_date < today && i.status === 'open');
    case 'today':
      return result.filter((i) => i.due_date === today);
    case 'tomorrow':
      return result.filter((i) => i.due_date === tomorrow);
    case 'this_week':
      return result.filter((i) => i.due_date && i.due_date >= today && i.due_date <= endWeek);
    case 'upcoming':
      return result.filter((i) => i.due_date && i.due_date > endWeek && i.status === 'open');
    case 'open':
      return result.filter((i) => i.status === 'open');
    case 'completed':
      return result.filter((i) => i.status === 'completed');
    case 'notes':
      return result.filter((i) => i.type === 'note');
    case 'todos':
      return result.filter((i) => i.type === 'todo');
    case 'all':
    default:
      return result;
  }
}

// ─── Routes ──────────────────────────────────────────────────────────────────

router.get('/auth/status', (req, res) => {
  res.json({
    success: true,
    auth_enabled: isAuthEnabled(),
    authenticated: isAuthenticated(req),
  });
});

router.post('/auth/login', (req, res) => {
  const { code } = req.body ?? {};

  if (!isAuthEnabled()) {
    return res.json({ success: true, authenticated: true, auth_enabled: false });
  }

  if (!verifyCode(code)) {
    return res.status(401).json({
      success: false,
      error: 'Invalid access code.',
    });
  }

  setSessionCookie(res);
  return res.json({ success: true, authenticated: true, auth_enabled: true });
});

router.post('/auth/logout', (_req, res) => {
  clearSessionCookie(res);
  res.json({ success: true });
});

router.use(requireAuth);

/** GET /api/items — return all non-deleted items */
router.get('/items', async (_req, res) => {
  try {
    const items = await getAllItems();
    res.json({ success: true, items });
  } catch (err) {
    console.error('[GET /items]', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/** POST /api/command — the main NLP endpoint */
router.post('/command', async (req, res) => {
  const { command } = req.body ?? {};

  if (!command?.trim()) {
    return res.status(400).json({ success: false, error: 'Command is required.' });
  }

  let parsed;
  try {
    parsed = await parseCommand(command);
    console.log('[PARSER]', JSON.stringify(parsed));
  } catch (err) {
    console.error('[PARSER ERROR]', err.message);
    return res.status(500).json({
      success: false,
      error: `Parsing error: ${err.message}`,
    });
  }

  if (parsed.intent === 'unknown') {
    const items = await getAllItems().catch(() => []);
    return res.json({
      success: false,
      message: parsed.message || "I couldn't understand that. Try: 'Add a todo to call the doctor tomorrow'.",
      items,
    });
  }

  try {
    let message = '';
    let items;
    let queryFilter = null;

    switch (parsed.intent) {
      // ── CREATE ─────────────────────────────────────────────────────────────
      case 'create': {
        const type =
          !parsed.item_type || parsed.item_type === 'any' ? 'todo' : parsed.item_type;
        const item = await createItem({
          type,
          content: parsed.content || 'Untitled',
          due_date: parsed.due_date,
        });
        message = `Created ${item.type}: "${item.content}"${
          item.due_date ? ` — due ${formatDateHuman(item.due_date)}` : ''
        }`;
        items = await getAllItems();
        break;
      }

      // ── COMPLETE ────────────────────────────────────────────────────────────
      case 'complete': {
        const all = await getAllItems();
        const target = findBestMatch(all, parsed.target_description, parsed.item_type);
        if (!target) {
          return res.json({
            success: false,
            message: `Couldn't find an item matching "${parsed.target_description}". Check the list and try again.`,
            items: all,
          });
        }
        await completeItem(target.id);
        message = `Marked as complete: "${target.content}"`;
        items = await getAllItems();
        break;
      }

      // ── DELETE ─────────────────────────────────────────────────────────────
      case 'delete': {
        const all = await getAllItems();
        const target = findBestMatch(all, parsed.target_description, parsed.item_type);
        if (!target) {
          return res.json({
            success: false,
            message: `Couldn't find an item matching "${parsed.target_description}". Check the list and try again.`,
            items: all,
          });
        }
        await deleteItem(target.id);
        message = `Deleted: "${target.content}"`;
        items = await getAllItems();
        break;
      }

      // ── UPDATE ─────────────────────────────────────────────────────────────
      case 'update': {
        const all = await getAllItems();
        const target = findBestMatch(all, parsed.target_description, parsed.item_type);
        if (!target) {
          return res.json({
            success: false,
            message: `Couldn't find an item matching "${parsed.target_description}". Check the list and try again.`,
            items: all,
          });
        }
        const updates = {};
        if (parsed.update_fields?.content)   updates.content  = parsed.update_fields.content;
        if (parsed.update_fields?.due_date !== undefined && parsed.update_fields?.due_date !== null) {
          updates.due_date = parsed.update_fields.due_date;
        }
        // If the parser put due_date at top level (some commands)
        if (!updates.due_date && parsed.due_date) updates.due_date = parsed.due_date;

        if (Object.keys(updates).length === 0) {
          return res.json({
            success: false,
            message: "I understood you want to update something but couldn't determine what to change.",
            items: all,
          });
        }

        await updateItem(target.id, updates);
        let detail = '';
        if (updates.content)  detail += ` — new text: "${updates.content}"`;
        if (updates.due_date) detail += ` — rescheduled to ${formatDateHuman(updates.due_date)}`;
        message = `Updated: "${target.content}"${detail}`;
        items = await getAllItems();
        break;
      }

      // ── REOPEN ─────────────────────────────────────────────────────────────
      case 'reopen': {
        const all = await getAllItems();
        const target = findBestMatch(all, parsed.target_description, parsed.item_type);
        if (!target) {
          return res.json({
            success: false,
            message: `Couldn't find an item matching "${parsed.target_description}".`,
            items: all,
          });
        }
        await reopenItem(target.id);
        message = `Reopened: "${target.content}"`;
        items = await getAllItems();
        break;
      }

      // ── QUERY ──────────────────────────────────────────────────────────────
      case 'query': {
        items = await getAllItems();
        const filtered = filterByQuery(items, parsed.query_type, parsed.item_type);
        const labels = {
          overdue:   'overdue items',
          today:     "items due today",
          tomorrow:  "items due tomorrow",
          this_week: "items due this week",
          upcoming:  "upcoming items",
          open:      "open items",
          completed: "completed items",
          notes:     "notes",
          todos:     "todos",
          all:       "all items",
        };
        const label = labels[parsed.query_type] || 'items';
        message = filtered.length === 0
          ? `No ${label} found.`
          : `Showing ${filtered.length} ${label}.`;
        queryFilter = parsed.query_type;
        return res.json({ success: true, message, items, query_filter: queryFilter });
      }

      default:
        items = await getAllItems();
        message = 'Done.';
    }

    res.json({ success: true, message, items });
  } catch (err) {
    console.error('[COMMAND HANDLER]', err.message);
    res.status(500).json({ success: false, error: `Error: ${err.message}` });
  }
});

/** DELETE /api/items/:id — direct delete from UI */
router.delete('/items/:id', async (req, res) => {
  try {
    await deleteItem(req.params.id);
    const items = await getAllItems();
    res.json({ success: true, items });
  } catch (err) {
    console.error('[DELETE /items/:id]', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/** PATCH /api/items/:id/complete — direct complete toggle from UI */
router.patch('/items/:id/complete', async (req, res) => {
  try {
    await completeItem(req.params.id);
    const items = await getAllItems();
    res.json({ success: true, items });
  } catch (err) {
    console.error('[PATCH complete]', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/** PATCH /api/items/:id/reopen — reopen a completed item from UI */
router.patch('/items/:id/reopen', async (req, res) => {
  try {
    await reopenItem(req.params.id);
    const items = await getAllItems();
    res.json({ success: true, items });
  } catch (err) {
    console.error('[PATCH reopen]', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
