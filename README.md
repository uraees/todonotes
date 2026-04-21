# TodoNotes

A natural language notes and todo manager. Type plain English commands — the app figures out what to do and syncs everything to a Google Sheet.

## Tech stack

| Layer | Choice | Reason |
|-------|--------|--------|
| Backend | Node.js 18+ + Express | Lightweight, keeps API keys server-side |
| NLP | Anthropic API (`claude-sonnet-4-6`) | Parses freeform commands into structured intents |
| Storage | Google Sheets API v4 | Zero-infrastructure, inspectable, exportable |
| Frontend | Vanilla JS + CSS | No build step, fast, served directly by Express |

---

## Prerequisites

- Node.js 18 or newer
- An [Anthropic API key](https://console.anthropic.com/)
- A Google account to create a Service Account and a Spreadsheet

---

## 1 · Google Service Account setup

### 1.1 Create a Google Cloud project

1. Go to [https://console.cloud.google.com/](https://console.cloud.google.com/)
2. Click **Select a project → New Project**. Give it any name (e.g. `todonotes`).

### 1.2 Enable the Google Sheets API

1. In your project, go to **APIs & Services → Library**
2. Search for **Google Sheets API** and click **Enable**

### 1.3 Create a Service Account

1. Go to **APIs & Services → Credentials**
2. Click **Create Credentials → Service Account**
3. Give it a name (e.g. `todonotes-sheets`), click **Done**
4. Click the service account you just created
5. Go to the **Keys** tab → **Add Key → Create new key → JSON**
6. A `.json` file downloads. Open it — you need two values from it:
   - `client_email`  → this is your `GOOGLE_SERVICE_ACCOUNT_EMAIL`
   - `private_key`   → this is your `GOOGLE_PRIVATE_KEY`

### 1.4 Create the Google Spreadsheet

1. Go to [https://sheets.google.com/](https://sheets.google.com/) and create a new blank spreadsheet
2. Name it anything (e.g. **TodoNotes**)
3. Copy the spreadsheet ID from the URL:
   ```
   https://docs.google.com/spreadsheets/d/  THIS_IS_THE_ID  /edit
   ```
   That long string between `/d/` and `/edit` is your `GOOGLE_SHEETS_SPREADSHEET_ID`
4. **Share the spreadsheet** with the service account email (the `client_email` value) and give it **Editor** access

### 1.5 Sheet tab name

The default sheet tab is called `Sheet1`. You can rename it — just make sure `GOOGLE_SHEET_NAME` in your `.env` matches.

The app will automatically write the header row (`id`, `type`, `content`, `status`, `due_date`, `created_at`, `updated_at`) the first time it runs.

---

## 2 · Anthropic API key

1. Go to [https://console.anthropic.com/](https://console.anthropic.com/)
2. Create an API key
3. Copy it into `.env` as `ANTHROPIC_API_KEY`

---

## 3 · ngrok setup (optional — public URL)

ngrok tunnels your local server to a public HTTPS URL. The project is pre-configured to start ngrok automatically alongside Node when you run `npm run dev` or `npm start`.

### 3.1 Install ngrok

```bash
brew install ngrok         # macOS
# or download from https://ngrok.com/download
```

### 3.2 Add your authtoken

Sign up at [https://dashboard.ngrok.com/](https://dashboard.ngrok.com/), copy your authtoken, then run:

```bash
ngrok config add-authtoken <your-authtoken>
```

This writes the token to `~/.config/ngrok/ngrok.yml` once — you never need to repeat it.

### 3.3 Reserve a static domain (recommended)

Free ngrok accounts get one free static domain so the URL never changes between restarts.

1. Go to **Dashboard → Domains → New Domain**
2. Copy the domain (e.g. `your-name-word-word.ngrok-free.app`)
3. Update the domain in the `start` and `dev` scripts inside `package.json`:

```json
"dev": "concurrently ... \"ngrok http --domain=your-name-word-word.ngrok-free.app 3000\""
```

Without a static domain, ngrok generates a random URL each run — that works too, just changes every time.

---

## 4 · Local setup

```bash
# Clone / navigate to the project
cd todonotes

# Install dependencies
npm install

# Create your env file
cp .env.example .env
```

Edit `.env` and fill in all five values:

```env
ANTHROPIC_API_KEY=sk-ant-...
GOOGLE_SHEETS_SPREADSHEET_ID=1BxiMVs0XRA...
GOOGLE_SERVICE_ACCOUNT_EMAIL=todonotes-sheets@my-project.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\nMIIEo...\n-----END RSA PRIVATE KEY-----\n"
GOOGLE_SHEET_NAME=Sheet1
PORT=3000
```

### Optional: add a shared access code

If you want a quick lock screen in front of the UI, configure these optional variables:

```env
AUTH_CODE_SALT=choose-a-random-salt
AUTH_CODE_HASH=paste-the-generated-hex-hash
AUTH_SESSION_SECRET=choose-a-long-random-secret
AUTH_SESSION_TTL_HOURS=24
```

Generate the hash for a code such as `031973` with:

```bash
node -e "const crypto=require('crypto'); const code='031973'; const salt='choose-a-random-salt'; console.log(crypto.scryptSync(code, salt, 64).toString('hex'));"
```

Use a different random value for `AUTH_SESSION_SECRET`, for example:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

When these auth variables are set, the app shows a code prompt on first load and protects all `/api` calls behind a signed `HttpOnly` session cookie.

> **Private key tip:** Open the downloaded JSON file, find the `private_key` field, and paste its value (including the `-----BEGIN...` lines) into `GOOGLE_PRIVATE_KEY`. The value should stay on one line with literal `\n` sequences — do **not** press Enter inside the value.

---

## 5 · Running the server

Both commands start Node **and** ngrok together via `concurrently`:

```bash
# Development mode — auto-restarts Node on file changes
npm run dev

# Production mode
npm start
```

You will see two labelled log streams:

```
[node]  TodoNotes server running on port 3000
[ngrok] Forwarding https://your-domain.ngrok-free.app -> localhost:3000
```

- Local:  [http://localhost:3000](http://localhost:3000)
- Public: your ngrok URL (static domain stays the same across restarts)

> If you do not need ngrok, you can run `node --watch server/index.js` directly to skip it.

---

## 6 · How to use it

Type natural language commands into the text area and press **Execute** (or `Ctrl+Enter`).

### Example commands

| Intent | Example |
|--------|---------|
| Add a todo | `Add a reminder to file the taxes by Friday` |
| Add a note | `Note: the project kickoff meeting is on April 3rd` |
| Add with date | `Remind me to call the doctor next Monday` |
| Complete | `I've completed the task of paying the rent` |
| Delete | `Delete the note about the project kickoff meeting` |
| Update text | `Change the tax filing reminder to "Submit Q1 taxes"` |
| Reschedule | `Move the tax filing task to next Wednesday` |
| Query | `What do I have due this week?` |
| Query | `Show me everything that is overdue` |
| Query | `Show all open todos` |
| Query | `What's due today?` |

### Inline actions

Each item card has two icon buttons that appear on hover:
- **✓** — mark as complete
- **✕** — delete

Completed items appear in a separate **Completed** section and can be reopened with the **↩** button.

---

## 7 · Sheet structure (for manual inspection)

| Column | Field | Description |
|--------|-------|-------------|
| A | `id` | UUID — unique key per item |
| B | `type` | `note` or `todo` |
| C | `content` | The text of the item |
| D | `status` | `open`, `completed`, or `deleted` |
| E | `due_date` | ISO date `YYYY-MM-DD` or blank |
| F | `created_at` | ISO datetime |
| G | `updated_at` | ISO datetime |

Deleted items are **soft-deleted** (status = `deleted`) and never shown in the UI, but remain in the sheet for auditability.

---

## 8 · Architecture notes

```
server/
  index.js          — Express app, env validation, static file serving
  sheets.js         — Google Sheets CRUD layer (getAllItems, createItem, updateItem, …)
  parser.js         — NLP layer: sends user input to Anthropic, returns structured JSON
  routes/api.js     — Route handlers connecting parsed intents → sheet operations

public/
  index.html        — Single-page app shell
  styles.css        — Dark theme CSS (no framework)
  app.js            — Frontend: state, rendering, fetch calls
```

### NLP parser design

`parser.js` is isolated and independently testable. It:
1. Computes the current date context (today, tomorrow, next Monday, this Friday, etc.)
2. Builds a deterministic system prompt with those resolved dates baked in
3. Calls `claude-sonnet-4-6` and expects raw JSON back
4. Handles malformed responses with a single retry
5. Returns a typed `ParsedCommand` object the route handler consumes

### Fuzzy item matching

When a user says "complete the rent task", the app:
1. Loads all current items from the sheet
2. Strips stop-words and tokenises the description
3. Scores each item by keyword overlap + exact phrase bonus
4. Applies the item with the highest score

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `Missing required environment variables` | Fill in all values in `.env` |
| `Cannot read spreadsheet` | Check the spreadsheet ID and that the service account has Editor access |
| ngrok exits immediately | Run `ngrok config add-authtoken <token>` — the authtoken is missing or expired |
| ngrok `failed to start tunnel` | The static domain in `package.json` does not match the one reserved in your ngrok dashboard |
| ngrok starts but 502 errors | Node hasn't finished starting yet — wait a moment and reload |
| `Anthropic API error` | Check your API key and billing status |
| Parser returns "I couldn't understand" | Rephrase — the parser handles ambiguity by asking for clarification rather than guessing |
| Private key errors | Make sure newlines are `\n` (not literal), and the full key including headers is in the `.env` value |
