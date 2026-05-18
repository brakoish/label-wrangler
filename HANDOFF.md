# 🏷️ Label Wrangler — Agent Handoff

## Who You Are

You're the **Label Wrangler** agent — a project specialist for a web-based label format library and designer. Your workspace is `/home/mortyyy/.openclaw/workspace-labelflow/`. Read `SOUL.md`, `USER.md`, and `MEMORY.md` at every session start — that's your brain.

---

## Essential Files

| File | Purpose |
|---|---|
| `MEMORY.md` | Long-term project memory, architecture, key decisions, lessons learned. **The most important file.** |
| `memory/YYYY-MM-DD.md` | Daily notes. Write one after every significant session or you lose everything on restart. |
| `AGENTS.md` | Session startup checklist and cross-agent workspace map |
| `SOUL.md` | Persona and tone |
| `USER.md` | Will's preferences and context |

---

## The Stack

- **Next.js 16** (App Router), **Zustand**, **Tailwind CSS**, **Drizzle ORM + Neon PostgreSQL**
- **zpl-renderer-js** (Go→WASM, 8MB) for local ZPL label rendering
- **WebUSB / Dazzle** for direct thermal printer communication
- **PDF.js v4** (not v5 — Vercel worker compat issue)
- Repo: `brakoish/label-wrangler` | Local: `~/Projects/label-wrangler`
- Live: https://label-wrangler.vercel.app

---

## Daily Tools

| Tool | What I use it for |
|---|---|
| `exec` | Run builds, git commits, deploys, linting |
| `read` / `write` / `edit` | Code changes — `edit` for precise patches, `write` for new files |
| `web_fetch` / `web_search` | Docs lookup, checking Vercel deploy status |
| `memory_search` / `memory_get` | Recall prior decisions before touching anything |
| `session_status` | Check current time/model when needed |

---

## Deploy Flow

GitHub auto-deploy is **broken** as of Apr 20. Use this curl workaround every time:

```bash
curl -sX POST -H "Authorization: Bearer $VERCEL_TOKEN" \
  -H "Content-Type: application/json" \
  "https://api.vercel.com/v13/deployments?teamId=team_BDe5NBowWMIpipnXT9Mr7wMf&forceNew=1" \
  -d '{"name":"label-wrangler","target":"production","project":"prj_MYUIsuAzK3XGEWPCfZexnnV3SU0c","gitSource":{"type":"github","ref":"main","org":"brakoish","repo":"label-wrangler"}}'
```

Poll `GET /v13/deployments/{id}?teamId=...` until `readyState=READY`.

---

## Key Gotchas (Lessons Learned)

- **Never use `foreignObject` for text in SVG** — CSS font-size doesn't map to SVG viewBox units. Use native `<text>` + `<tspan>`.
- **Canvas inside SVG is invisible** — use `toDataURL()`, not `toCanvas()` for QR codes.
- **Multi-drag**: snapshot all element positions at drag start into a frozen Map. Reading live state during drag causes compounding position errors.
- **Resize handles**: use window-level pointer listeners, not child element capture — `setPointerCapture` on child SVGs blocks parent `onPointerMove`.
- **Word-wrap**: `maxLines` must be ≥1 always.
- **Font size units**: pts → sheet labels divide by 72, thermal multiply by DPI/72.

---

## Engineering Rules (locked in by Will)

1. Don't assume. Surface tradeoffs.
2. Minimum code that solves the problem. Nothing speculative.
3. Touch only what you must.
4. Define success criteria. Loop until verified.

---

## The User

**Will** (wttw) — designer, entrepreneur. Values directness, no fluff. Calls are rare; most work happens async in Discord. He'll say "go" when he's ready and expects you to run with it.

---

*Good luck Jimbo 🤠*
