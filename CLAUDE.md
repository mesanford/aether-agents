# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development (runs server + Vite dev middleware together)
npm run dev

# Production build then serve
npm run preview

# Type check only (no emit)
npm run lint

# All tests
npm test

# Unit tests only
npm run test:unit

# Integration tests only
npm run test:integration

# Run a single unit test file
node --import tsx --test tests/unit/validators.unit.test.ts
```

## Environment

Secrets live in `.env.local` (takes precedence over `.env`). Required vars:

- `DATABASE_URL` — PostgreSQL connection string
- `GEMINI_API_KEY` / `GOOGLE_API_KEY` — Gemini model access
- `JWT_SECRET`
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` — OAuth
- `LINKEDIN_CLIENT_ID` / `LINKEDIN_CLIENT_SECRET`
- `ZERNIO_API_KEY` / `ZERNIO_WEBHOOK_SECRET`

Always reference **https://ai.google.dev/gemini-api/docs/models** for current Gemini model IDs before questioning model names in `graph.ts`.

## Architecture

This is a **single-process full-stack app**: one Express server (`server.ts`) serves the REST API and also hosts the Vite-built React SPA from `dist/`. In dev mode Vite middleware runs in-process; in production it serves `dist/` statically.

### Server bootstrap sequence (`server.ts`)

1. Express app + middleware created
2. `/api/health` liveness endpoint registered immediately
3. All route modules registered (see below)
4. Server starts listening
5. `bootstrapDatabase()` runs async (schema creation, seeding) — server is already accepting traffic
6. Background jobs start: `startTaskEngine()` (polls every 60 s) and `startSequenceDaemon()` (cron `*/15`)

### Database (`src/server/db.ts`)

`PostgresShim` wraps `node-postgres` with a SQLite-style `db.prepare(sql).run(...args)` / `.get()` / `.all()` API. SQL uses `?` placeholders which the shim converts to `$1, $2, ...` for Postgres. The shim is a singleton exported as `db` — import it directly in server-side files.

### AI graph (`src/server/ai/graph.ts`)

LangGraph `StateGraph` with this topology:

```
START → supervisor (or direct-message shortcut)
supervisor → specialist agent node (by ID)
specialist → tool_node | compaction_node | approval_node | END
tool_node → specialist (returns to caller by sender field)
compaction_node → supervisor
approval_node → tool_node (after human approval via /api/workspaces/:id/chat/approve)
```

- **Checkpointer**: `PostgresSaver` (was `MemorySaver` — do not revert; MemorySaver caused OOM crashes on Cloud Run)
- **Models**: primary `gemini-3-flash-preview`, fallback `gemini-2.5-flash`; lite `gemini-3.1-flash-lite-preview`, lite fallback `gemini-2.5-flash-lite`. All via `ChatGoogleGenerativeAI`.
- **Compaction**: fires when estimated tokens > 60k — summarizes old messages into `episodicGist` to avoid context explosion
- **Direct-message routing**: a message starting with `[Direct message to <agentId>]` bypasses the supervisor and routes straight to the named agent

### Agents (`src/server/ai/agents.ts`)

Seven fixed specialist agents with static IDs. IDs are the routing keys throughout the system:

| ID | Default Name | Primary Role |
|---|---|---|
| `executive-assistant` | Eva | Email, calendar, tasks |
| `sales-associate` | Stan | Sequences, CRM, outreach |
| `blog-writer` | Penny | SEO blog & newsletters |
| `social-media-manager` | Sonny | Social posts & scheduling |
| `receptionist` | Rachel | Intake & FAQs |
| `legal-associate` | Linda | Contracts & compliance |
| `team-chat` | Team Chat | Coordination |

Display names are overrideable per-workspace in the DB (`agents` table). `agentNames` in `AgentState` carries the resolved names for each invocation.

### Tools (`src/server/ai/tools.ts`)

~30 tools; each agent has a curated subset defined in `agentToolMapping` in `graph.ts`. Tools access `db` via the singleton import and get `workspace_id` from `config.configurable.workspace_id` (injected by the graph on every invocation).

Key tool groups:
- **Memory**: `query_brain`, `write_to_memory` (long-term via `stan_memory_ledger` table)
- **Sequences**: `create_sequence`, `activate_sequence`, `enroll_sequence_contacts`, `get_sequence_analytics`, `update_sequence`, `pause_sequence` — sequences can be local (daemon-managed) or Zernio-synced
- **CRM**: `update_crm`, `list_local_leads`, `sync_leads_to_zernio`
- **Comms**: `draft_email`, `send_sms`, `send_slack_message`, `send_teams_message`
- **Content**: `generate_image`, `publish_blog_post`, `draft_social_post`, `schedule_social_post`

### Background jobs

**Task Engine** (`src/server/taskEngine.ts`): polls `tasks` table every 60 s for due recurring tasks, invokes the graph to execute them.

**Sequence Daemon** (`src/server/sequenceDaemon.ts`): cron `*/15` — processes `sequence_enrollments` where `status = 'Active'` and `next_execution_datetime <= now` and `zernio_sequence_id IS NULL` (local-only sequences). Invokes the graph with Stan directly. Zernio-synced sequences are delivered server-side by Zernio.

**Zernio Webhook** (`src/server/zernioWebhook.ts`): receives real-time events (reply received, message failed, etc.) and dispatches reactive graph invocations. Verified via HMAC-SHA256 signature.

### Rate limiting

`checkAndIncrementDailyAIRequestLimit()` in `rateLimiterUtility.ts` guards every graph invocation (chat route, task engine, sequence daemon). Limit is stored per-workspace in `workspace_automation_settings.max_daily_ai_requests` (default 300/day). Throws `DailyLimitExceededError` when exceeded — callers must catch this specifically.

### Route modules

All registered in `server.ts` as `register*Routes({ app, db, requireAuth, ... })`:

- `authRoutes` — login, register, Google OAuth, JWT issue
- `workspaceRoutes` — workspace CRUD, agent config, tasks, leads, messages, knowledge docs
- `aiRoutes` — `/api/workspaces/:id/chat` (main chat), `/api/workspaces/:id/chat/history`, onboarding scrape
- `integrationsRoutes` — OAuth flows for Gmail/Calendar/Drive/LinkedIn/Slack/Teams/Notion/Buffer
- `googleDriveRoutes` — Drive file operations
- `approvalRoutes` — human-in-the-loop approval for risky tool calls
- `notificationRoutes` — Web Push subscription management

### Frontend (`src/`)

Standard React 19 + Vite SPA. Main entry `src/main.tsx` → `src/App.tsx`. API calls go through `src/services/geminiService.ts` (chat) and `src/services/apiClient.ts` (typed fetch wrapper with auth + timeout + `ApiError` on non-2xx). All AI responses go through the single `/api/workspaces/:id/chat` endpoint — the frontend is not aware of individual agents.

### Key conventions

- `PostgresShim.prepare(sql).run/get/all` is async — always `await`
- SQL placeholders are `?` (not `$1`) — the shim converts them
- `workspace_id` is always a number in the DB but arrives as a string from `req.params.id` — parse with `parseInt` before numeric comparisons
- `approvalRequired` tools (write_workspace_file, linkedin_outreach, send_sms, schedule_social_post) pause the graph before execution; resume via the approval route
- The `REPLACE_MESSAGES` sentinel in `customMessagesReducer` is used by the compaction node to wholesale swap the message array without appending
