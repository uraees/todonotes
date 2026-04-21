/**
 * NLP parsing layer — isolated and independently testable.
 *
 * Takes a raw user command string + current date context, calls the Anthropic API,
 * and returns a structured ParsedCommand object.
 *
 * ParsedCommand schema:
 * {
 *   intent:             "create" | "update" | "delete" | "complete" | "reopen" | "query" | "unknown"
 *   item_type:          "note" | "todo" | "any"
 *   content:            string | null      — for create: the item text; for update: new content text
 *   due_date:           string | null      — resolved ISO date YYYY-MM-DD
 *   target_description: string | null      — natural language description of the target item (update/delete/complete)
 *   update_fields: {
 *     content:  string | null              — new content (if changing text)
 *     due_date: string | null              — new due date (if changing date)
 *   } | null
 *   query_type:  "all" | "open" | "completed" | "overdue" | "today" | "tomorrow" |
 *                "this_week" | "upcoming" | "notes" | "todos" | null
 *   message:     string | null             — clarification text when intent is unknown
 * }
 */

import OpenAI from 'openai';

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ─── Date helpers ────────────────────────────────────────────────────────────

function toISO(d) {
  return d.toISOString().split('T')[0];
}

function dateContext() {
  const now = new Date();
  const today = toISO(now);

  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);

  // Next Monday (always in the future)
  const nextMonday = new Date(now);
  const dow = nextMonday.getDay(); // 0=Sun
  nextMonday.setDate(nextMonday.getDate() + (dow === 0 ? 1 : 8 - dow));

  // This Friday (coming)
  const friday = new Date(now);
  const daysToFri = (5 - friday.getDay() + 7) % 7 || 7;
  friday.setDate(friday.getDate() + daysToFri);

  // End of this week = Sunday
  const sunday = new Date(now);
  sunday.setDate(sunday.getDate() + (7 - sunday.getDay()) % 7 || 7);

  // In 3 days
  const in3 = new Date(now);
  in3.setDate(in3.getDate() + 3);

  // In 7 days
  const in7 = new Date(now);
  in7.setDate(in7.getDate() + 7);

  return {
    today,
    tomorrow: toISO(tomorrow),
    nextMonday: toISO(nextMonday),
    friday: toISO(friday),
    endOfWeek: toISO(sunday),
    in3days: toISO(in3),
    in7days: toISO(in7),
    dayName: now.toLocaleDateString('en-US', { weekday: 'long' }),
  };
}

// ─── System prompt ───────────────────────────────────────────────────────────

function buildSystemPrompt(ctx) {
  return `You are the natural language parser for a notes and todo management app.
Your ONLY job is to parse the user's command and return a JSON object. No prose, no markdown, no explanation — raw JSON only.

== CURRENT DATE CONTEXT ==
Today            : ${ctx.today} (${ctx.dayName})
Tomorrow         : ${ctx.tomorrow}
Next Monday      : ${ctx.nextMonday}
This Friday      : ${ctx.friday}
End of this week : ${ctx.endOfWeek}
In 3 days        : ${ctx.in3days}
In 7 days        : ${ctx.in7days}

== OUTPUT SCHEMA ==
{
  "intent":             "create" | "update" | "delete" | "complete" | "reopen" | "query" | "unknown",
  "item_type":          "note" | "todo" | "any",
  "content":            string | null,
  "due_date":           string | null,   // YYYY-MM-DD, resolved from the date context above
  "target_description": string | null,   // for update/delete/complete/reopen: describe the item to act on
  "update_fields": {
    "content":  string | null,
    "due_date": string | null
  } | null,
  "query_type": "all" | "open" | "completed" | "overdue" | "today" | "tomorrow" | "this_week" | "upcoming" | "notes" | "todos" | null,
  "message": string | null
}

== RULES ==
1. Resolve ALL date references to YYYY-MM-DD — both relative ("tomorrow", "next Monday") using the date context above, AND absolute ("September 26th", "March 3rd", "the 15th") using the current year (${ctx.today.slice(0,4)}). If an absolute date has already passed this year, use next year.
   Never output relative strings — always output the ISO date.
2. "remind me", "reminder", "task", "todo" → item_type = "todo"
   "note", "write down", "jot" → item_type = "note"
   Ambiguous → item_type = "todo"
3. For "create": content = what to remember/do. due_date = when (if mentioned), else null.
4. For "update": target_description = which item to change. update_fields = what to change.
   Only populate update_fields.content if the text is changing.
   Only populate update_fields.due_date if the date is changing.
5. For "complete": target_description = description of the completed item.
6. For "delete": target_description = description of the item to remove.
7. For "reopen": target_description = description of the completed item to reopen.
8. For "query": choose the best query_type. "this_week" covers today through end of week.
   "upcoming" means beyond this week. "all" is everything.
9. IMPORTANT: This app only TRACKS tasks — it never executes them. NEVER refuse a command by saying it is "outside scope". Any statement like "X needs to be done by Y" or "cancel X before Y" is ALWAYS a create todo intent. Default to create + item_type = "todo" when in doubt.
10. Only use intent = "unknown" if you truly cannot extract any meaningful content from the input (e.g. completely unintelligible text).

== EXAMPLES ==
Input:  "Can you add a reminder for tomorrow to file the taxes"
Output: {"intent":"create","item_type":"todo","content":"File the taxes","due_date":"${ctx.tomorrow}","target_description":null,"update_fields":null,"query_type":null,"message":null}

Input:  "I have completed the task of paying the rent originally requested as a todo for tomorrow"
Output: {"intent":"complete","item_type":"todo","content":null,"due_date":null,"target_description":"paying the rent","update_fields":null,"query_type":null,"message":null}

Input:  "Remind me to call the doctor next Monday"
Output: {"intent":"create","item_type":"todo","content":"Call the doctor","due_date":"${ctx.nextMonday}","target_description":null,"update_fields":null,"query_type":null,"message":null}

Input:  "Delete the note about the project kickoff meeting"
Output: {"intent":"delete","item_type":"note","content":null,"due_date":null,"target_description":"project kickoff meeting","update_fields":null,"query_type":null,"message":null}

Input:  "What do I have due this week"
Output: {"intent":"query","item_type":"any","content":null,"due_date":null,"target_description":null,"update_fields":null,"query_type":"this_week","message":null}

Input:  "Change the tax filing reminder to Friday"
Output: {"intent":"update","item_type":"any","content":null,"due_date":null,"target_description":"tax filing reminder","update_fields":{"content":null,"due_date":"${ctx.friday}"},"query_type":null,"message":null}

Input:  "Show me everything that is overdue"
Output: {"intent":"query","item_type":"any","content":null,"due_date":null,"target_description":null,"update_fields":null,"query_type":"overdue","message":null}

Input:  "Add a note: project kickoff meeting is on Thursday at 2pm"
Output: {"intent":"create","item_type":"note","content":"Project kickoff meeting is on Thursday at 2pm","due_date":null,"target_description":null,"update_fields":null,"query_type":null,"message":null}

Input:  "Show all open todos"
Output: {"intent":"query","item_type":"todo","content":null,"due_date":null,"target_description":null,"update_fields":null,"query_type":"open","message":null}`;
}

// ─── Main export ─────────────────────────────────────────────────────────────

/**
 * Parse a natural language command into a structured intent object.
 * @param {string} userInput
 * @returns {Promise<ParsedCommand>}
 */
async function parseCommand(userInput) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not set in .env');
  }

  const ctx = dateContext();
  const systemPrompt = buildSystemPrompt(ctx);

  let responseText;
  try {
    const msg = await client.chat.completions.create({
      model: 'gpt-4o',
      max_tokens: 1024,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userInput },
      ],
    });
    responseText = msg.choices[0].message.content.trim();
  } catch (err) {
    throw new Error(`OpenAI API error: ${err.message}`);
  }

  // Strip accidental markdown code fences
  let jsonText = responseText;
  if (jsonText.startsWith('```')) {
    jsonText = jsonText.replace(/^```[a-z]*\n?/, '').replace(/\n?```$/, '').trim();
  }

  let parsed;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    // One retry: ask again with a stricter reminder
    try {
      const retry = await client.chat.completions.create({
        model: 'gpt-4o',
        max_tokens: 1024,
        messages: [
          { role: 'system', content: systemPrompt + '\n\nCRITICAL: Your previous response was not valid JSON. Return ONLY the JSON object, nothing else.' },
          { role: 'user', content: userInput },
          { role: 'assistant', content: responseText },
          { role: 'user', content: 'That was not valid JSON. Return only the JSON object.' },
        ],
      });
      const retryText = retry.choices[0].message.content.trim().replace(/^```[a-z]*\n?/, '').replace(/\n?```$/, '').trim();
      parsed = JSON.parse(retryText);
    } catch {
      return {
        intent: 'unknown',
        item_type: 'any',
        content: null,
        due_date: null,
        target_description: null,
        update_fields: null,
        query_type: null,
        message: "I couldn't understand that command. Try something like: 'Add a todo to call the doctor tomorrow' or 'What's due this week?'",
      };
    }
  }

  return parsed;
}

export { parseCommand };
