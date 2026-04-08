# ClarionChain / DC Workbench — product roadmap

**For LLMs and future sessions:** Read **§ Architecture & product decisions** first. It records agreed constraints so implementation stays compatible with deferred **subscriptions, credits, and multi-rail payments** without redesigning core features later.

Ordered for **incremental delivery**: each phase below should be shippable before moving on. Use **GitHub Issues** as the formal tracker for tasks; link PRs with `Fixes #n`.

---

## Architecture & product decisions (continuity)

### Planning workflow

| Decision | Detail |
|----------|--------|
| **Formal backlog** | **GitHub Issues** (optionally GitHub Projects) = source of truth for buildable work. |
| **Personal notes** | **Obsidian** (or similar) = brainstorming and linking ideas only; **do not** duplicate the same tasks in two systems. |
| **This file** | High-level phases + **immutable-ish decisions**; keep it accurate when strategy changes. |

### Monetization: defer implementation, not design

| Decision | Detail |
|----------|--------|
| **Near-term focus** | Ship **product features** (OpenRouter agent, chart assist, templates, reports, summarize) **before** Stripe, credit ledgers, and full billing UI. |
| **Business intent** | **Subscription model** is likely: users pay monthly, receive **credits** for **OpenRouter-backed** usage; operator uses subscription revenue to fund OpenRouter (and related) costs. **Solo dev / pre-launch:** single operator use is fine; monetization timing is TBD. |
| **Payment rails (later)** | **Stripe** (cards) first for mainstream checkout. Then consider **Bitcoin on-chain**, **Lightning**, **Cashu**, **L402** / **x-cashu-402**, and **MPP (e.g. Lightspark)** for automation / machine-style pay-per-use (e.g. analyst pipelines, newsletters). |
| **Risk to avoid** | Building features in a way that **cannot** attach `userId`, **metering**, or **entitlements** later without rewiring every route. |

### Payment-ready guardrails (implement now; no Stripe required)

Apply these while adding AI, summarize, reports, etc.:

1. **Authenticated server routes** — Any capability that may eventually cost money must **require session auth** and resolve **`userId` on the server** (never trust client-supplied identity for billing).
2. **Single choke point** — Prefer one internal helper (e.g. `assertCanUseAi(userId)` or shared middleware) that today always allows, but later enforces **credits / subscription tier**. Avoid scattering ad-hoc checks.
3. **Usage logging (recommended)** — Optional early: append-only rows for AI calls (`user_id`, model, rough tokens or cost estimate, timestamp). Enables fairness, abuse detection, and future invoicing without changing route shapes.
4. **Server-owned state for billable work** — Prefer server persistence for workbooks / jobs that tie to billing; avoid **client-only** flows for features that will be metered.
5. **Canonical identity** — **`user_id` (integer PK in SQLite)** is the canonical principal. **Email** is an **attribute** (good for Stripe); **wallet / LN / API key** links later should still map to the same `user_id` where possible.
6. **Future API / 402 / MPP** — Headless and machine payments imply **scoped credentials** (e.g. API keys or tokens) bound to `user_id`. Do not assume **browser cookies only** forever; leave a conceptual place for **service accounts** or **pat** without building them until needed.

### OpenRouter

| Decision | Detail |
|----------|--------|
| **Gateway** | **OpenRouter** = primary LLM HTTP integration (unified models; can include self-hosted endpoints if supported). |
| **Dual billing** | Support **both** **BYOK** (user’s OpenRouter key, server-stored only) **and** **pay-as-you-go** (operator `OPENROUTER_API_KEY` + entitlement/metering later). **Resolution order** (server-only): `assertCanUseAi(userId)` (stub allow-all today) → resolve key by user **AI key mode**: **`auto`** uses BYOK if a valid encrypted key exists, else platform key if user allows platform billing and operator key is set; **`byok_only`** requires BYOK; **`platform_only`** uses operator key only. **Never** return the full BYOK secret to the client after save (masked status only). |
| **Secrets** | **API keys never** in `NEXT_PUBLIC_*` or client bundles. **Platform:** `OPENROUTER_API_KEY` (server env). **BYOK:** ciphertext in SQLite, **AES-256-GCM** with `WORKBENCH_BYOK_ENCRYPTION_KEY` (64 hex chars); in development only, key may be derived from `WORKBENCH_SESSION_SECRET` if the dedicated key is unset (logged once). |
| **User-facing config** | **Account → AI & OpenRouter**: model, key mode, allow platform billing, paste/rotate/clear BYOK. Summarize and agent share resolution: **per-request model override → user preference → `OPENROUTER_DEFAULT_MODEL` → built-in default**. |
| **Metering** | **`ai_usage_log`** (append-only): `user_id`, `source` (`byok` \| `platform`), model, token counts when available—feeds future credits/invoicing without changing route shapes. |
| **UI shape** | **Agent**: Chrome-style **right panel** (e.g. ClarionAI-style: model strip, category tabs, markdown analysis, follow-up + send), main chart reflows on desktop; mobile uses sheet/full-width. **Summarize**: **separate entry point**, **shared** server LLM resolution. |

### Summarize.sh / summarize tooling

| Decision | Detail |
|----------|--------|
| **Integration** | Prefer **reusing** upstream open-source tooling (e.g. **steipete/summarize**); verify **license** in the exact repo pinned for production (**MIT** as of common upstream—retain notices / `THIRD_PARTY` as required). |
| **LLM** | Summarize pipeline should use **the same OpenRouter resolution** as the in-app agent (user-configured model where applicable). |
| **Legal / ops** | YouTube/third-party content: ToS, user-supplied URLs vs server fetch, retention—track in issues when integrating. |

### Deployment & data layer

| Decision | Detail |
|----------|--------|
| **Current stack** | Next.js App Router, **Node** API routes, **better-sqlite3**, **SQLite file** on **persistent volume** (Docker), JWT session cookie. |
| **Philosophy** | Favor **simple ops** (levels.io-style): single (or few) instances, **vertical scale**, solid backups—before jumping to complex multi-region patterns. |
| **Hosting fit** | **Strong fit:** **VPS**, or **PaaS with persistent disk** (Fly.io, Railway, Render with volume, etc.) running Docker or long-lived Node. **Poor fit out of the box:** **Vercel serverless-only** + on-disk SQLite (ephemeral FS, many instances). Moving to Vercel later usually implies **managed DB** (e.g. Postgres, Turso) and a **migration**—plan deliberately, not accidentally. |
| **Scaling SQLite** | One **writer** per DB file; multi-region multi-writer requires different DB strategy (managed replicated DB, Turso, etc.). |

### What *not* to do (causes expensive redesign)

- Unauthenticated or shared **AI / summarize / report** endpoints for production-shaped features.
- **Billing or credit logic** copy-pasted across many handlers with no shared guard.
- **No server-side** notion of who triggered metered work.
- **Hard-coding** single-tenant assumptions into types and APIs everywhere (okay for deploy config, not for domain model).

---

## Phase 0 — How we work

- [ ] Use **GitHub Issues** (and optionally Projects) as the source of truth for buildable work; link PRs with `Fixes #n`.
- [ ] Optional: **Obsidian** (or similar) for personal brainstorming only—do not duplicate the same backlog in two systems.
- [ ] **Staging** env + secrets discipline before exposing paid or high-cost AI endpoints.
- [ ] When adding meterable features, follow **§ Payment-ready guardrails** above.

---

## Phase 1 — OpenRouter + AI agent panel (foundation)

- [x] **OpenRouter** gateway: **BYOK** (encrypted in SQLite) **+** **platform** `OPENROUTER_API_KEY`; server helper **`resolveOpenRouterForUser(userId)`**; **`assertCanUseAi(userId)`** (allow-all stub); **`POST /api/ai/chat`** (streaming + optional **`chartContext`** merge into system prompt); **`GET`/`PATCH /api/ai/settings`**; **`GET /api/ai/models`** (10m cache); **`ai_usage_log`** (incl. stream requests with null token counts when needed).
- [x] **Settings → AI** + **workbench assistant**: model via combobox (**OpenRouter model list** + free-text); **Account** page for keys/modes.
- [x] **Right-side panel UI**: docked **Clarion assistant** (category tabs, markdown replies, follow-up, clear thread); desktop **~420px** column; **mobile bottom sheet** + backdrop; toolbar **Assistant** toggle; prefs in **`localStorage`** (`dc_workbench_assistant_open`).
- [x] **Streaming** in panel UI; **in-memory thread** (last 36 turns cap); error states surfaced inline.
- [x] **Structured chart context**: **`buildChartContextMarkdown`** (workbook, visible time range from chart API, pane scales, per-series stats/samples, crosshair snapshot) sent as **`chartContext`** and merged server-side with the category system prompt.
- [ ] **Optional later**: image/screenshot of chart for vision models if still needed.
- [x] **Auth + guardrail**: `POST /api/ai/*` requires session; **`assertCanUseAi`** central hook for credits later.

---

## Phase 2 — AI-assisted charts (create & edit)

- [ ] Agent can **propose or apply** workbook/chart configurations (metrics, panes, formulas) as a **structured action** (JSON or tools), not free-form DOM.
- [ ] **Safeguards**: confirm before apply, **undo/history**, clear diff of what changed; harden against **prompt injection** from untrusted text.
- [ ] Users can **always** hand-build or **edit** anything the agent created.

---

## Phase 3 — Default chart suite (templates / gallery)

- [ ] **Large curated set** of ready-made charts (inspired by checkonchain-style coverage): Bitcoin-focused defaults users can open in one action.
- [ ] Coexists with **custom** charts and **AI-generated** charts.
- [ ] Clear naming, categories, and “duplicate to my workbench” (or equivalent) flow.

---

## Phase 4 — Scheduled reports (push, not pull)

- [ ] **Backend job** (cron / queue / workflow): daily or multi–times-per-week **AI-generated reports**.
- [ ] **Reports page** in-app (nav placement TBD—e.g. left sidebar); list, open, timestamp, model used.
- [ ] **Notifications** (optional v2): in-app or email when a new report is ready.
- [ ] Billing for reports **TBD**; design storage and access so paywall can be added later.

---

## Phase 5 — Video / YouTube summaries (summarize.sh)

- [ ] Integrate **summarize** (open source; pin repo and honor **LICENSE** / notices) or equivalent pipeline.
- [ ] **Separate UI** from agent panel; **same** server LLM resolution as OpenRouter settings (see **§ OpenRouter**).
- [ ] Legal/ops: ToS, user-supplied links vs server fetch, retention.

---

## Phase 6 — Accounts & identity (expand beyond current Workbench auth)

- [ ] Today: password login + SQLite users. **Expand** for product scale: profiles, recovery, optional **2FA**, roles (admin vs user).
- [ ] **Entitlements**: which features, models, quotas, and report access per tier.
- [ ] **Data**: export/delete, retention policy for chats, summaries, reports.
- [ ] Room for **API keys / service principals** mapped to `user_id` (402 / MPP / automation).

---

## Phase 7 — Payments & entitlements

- [ ] **Stripe** (fiat) first—subscriptions or credits, invoices, tax as needed.
- [ ] Then **Bitcoin on-chain**, **Lightning**, **Cashu**, **L402** / **x-cashu-402**, **MPP** as follow-ons.
- [ ] **Usage metering**, per-user/org budgets, and admin visibility into **model cost** (OpenRouter spend).

---

## Phase 8 — Platform hardening

- [ ] **Rate limiting** and abuse controls on auth, AI, and summarize endpoints.
- [ ] **Observability**: structured logs, error tracking, safe debugging for AI failures.
- [ ] **Exports**: chart/report PNG/PDF or share links if product requires.
- [ ] **Public trust**: privacy policy, terms, support path, “not financial advice” and attribution (e.g. BitView) on AI outputs.

---

## Reference — feature buckets (GitHub issue tags)

| Theme | Items |
|--------|--------|
| AI & UX | OpenRouter, right panel, chart context, AI chart CRUD, optional vision |
| Content | Default chart library, scheduled reports page, YouTube/video summarize |
| Business | Expanded accounts, Stripe, BTC/LN/Cashu/L402/MPP, metering |
| Quality | Safeguards, retention, legal, observability, rate limits |

---

*Last updated: Phase 1 assistant panel, streaming UI, chart context pipeline, `/api/ai/models`.*
