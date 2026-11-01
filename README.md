# STI Assist AI

An unofficial, handbook-grounded student assistant for **STI High School**. It answers questions about school rules using the **STI High School Student Handbook (July 2026)** and shows the section and printed page behind every answer.

> **Unofficial prototype.** STI Assist AI is not affiliated with, endorsed by, or operated by STI. It is not an official school service. Handbook text and STI marks belong to their respective owners. Always confirm important policies with your adviser or school office.

---

## Contents

- [What it does](#what-it-does)
- [Important limitations](#important-limitations)
- [Implemented vs. future setup](#implemented-vs-future-setup)
- [How it works](#how-it-works)
- [Requirements](#requirements)
- [Quick start (local demo mode)](#quick-start-local-demo-mode)
- [Cloudflare Workers (free plan)](#cloudflare-workers-free-plan)
- [Enable AI answers (NVIDIA NIM)](#enable-ai-answers-nvidia-nim)
- [Handbook indexing](#handbook-indexing)
- [Configuration](#configuration)
- [API](#api)
- [Safety behavior](#safety-behavior)
- [Privacy and security](#privacy-and-security)
- [Testing](#testing)
- [Troubleshooting](#troubleshooting)
- [Project structure](#project-structure)
- [Verification status](#verification-status)

---

## What it does

- Answers questions about IDs, uniforms, tardiness, absences, gadgets, discipline, bullying, lost items, and other handbook topics.
- **Streams AI answers** as they are written, so students see the first words in about a second instead of waiting for the whole reply.
- **Links every citation to the PDF page** when the handbook PDF is served, so students can verify the source in one click.
- Supports **English, Filipino, Taglish, and common spelling mistakes** through multilingual embeddings, synonym expansion, and fuzzy keyword matching.
- Grounds answers in retrieved handbook passages and cites the **section and printed page**.
- Shows expandable **source cards** so students can read the exact retrieved excerpt.
- Refuses requests for help with weapons concealment, violence, threats, self-harm, cheating, evading school rules, or bypassing security.
- Handles image uploads with preview, progress, removal, and (when AI is configured) vision transcription plus a handbook-grounded follow-up answer.
- Clearly distinguishes **local demo mode** from **AI mode** and never presents direct excerpts as AI-generated.
- Offers a **“Handbook only” mode** on AI-configured servers: direct excerpts with no model call, labelled “Handbook excerpts — not AI-written.”
- Suggests **follow-up questions** drawn from the cited sections, turns **inline “p. 39” citations into links** that open the matching source card, and highlights the question's words inside excerpts.
- Adds **quick actions (Ctrl/Cmd+K)**, a **sidebar table of contents**, **dictation** where the browser supports it, **anonymous “Helpful / Needs work” feedback**, and **copy-with-sources / print** for answers.
- Reports a per-answer **confidence level** (strong / partial / weak / none) from retrieval quality, and warns when the handbook PDF changed after the index was built.
- Installs as a **PWA** with an offline shell fallback (API calls and the PDF are never cached).
- Supports **light, dark, and follow-system themes** with an explicit header menu that remembers the choice.
- Keeps images in server memory only and keeps conversations in browser memory only.
- Includes rate limits, upload validation, safe error messages, CSP/Helmet headers, same-origin write checks, and a 70-test automated suite.

### Demo mode vs AI mode

| | Local demo | AI mode |
|---|---|---|
| Trigger | No real `AI_API_KEY` | Valid AI key and model configured |
| What the student sees | Direct handbook excerpts, labelled **“Local demo — not AI”** | A written answer, labelled **“AI-generated”** |
| AI request made? | **No** | Yes |
| Image analysis | Not performed; the UI says so | Vision model first, then text model |
| Badge | **Demo · not AI** | **AI configured · not verified** until a real success, then **AI verified** |

Demo mode is fully functional for retrieval and citations. It is intentionally not described as AI.

---

## Important limitations

- **This is an unofficial prototype.** It is not an STI service and must not be presented as one.
- **Live AI was verified on 2026-10-31** with a real NVIDIA key (`nvidia/nemotron-3.5-bolt-e4b` for chat, `nvidia/nemotron-3.5-super-vl-120b-a12b` for vision). Model availability is account-scoped, so a different key may need different model IDs. See [Verification status](#verification-status).
- The index covers **printed pages 9–61** of the student-policy chapters. Appendices, forms, and the table of contents are excluded.
- Printed page numbers are **one less** than the PDF page numbers (`printed page = PDF page − 1`).
- The handbook states it applies to all students unless a specific policy says otherwise. It does **not** name a campus.
- Later official STI announcements or campus-specific rules may supersede the handbook.
- AI answers can still be wrong, incomplete, or cite a passage that does not fully answer the question. Source cards exist so users can verify. The server also checks citations and warns when a page reference is missing or not among the retrieved passages.
- PDF text extraction can merge columns, split sentences, or drop characters. Citations should be checked against the PDF.
- Safety guidance is not a substitute for emergency services or professional care. In the Philippines, call **911** for immediate danger.

---

## Implemented vs. future setup

**Working now (verified in this workspace):**

| Area | Status |
|---|---|
| Handbook extraction, section-aware chunking, printed-page mapping | 171 chunks, 131 sections, pp. 9–61 |
| Local multilingual embeddings (no API key needed to index) | 384-dim, cached in `data/models` |
| Hybrid retrieval: dense cosine + BM25 + heading/topic boosts | Verified for ID, uniform, tardiness, gadgets, lost items, discipline, weapons |
| Taglish, Filipino, and misspelled queries | Verified end to end |
| Grounded prompt, citation rules, runtime citation verification | Answers citing a page outside the retrieved passages are flagged |
| Streaming answers over SSE | `/api/chat/stream` emits sources first, then text deltas, then the verified final answer |
| One-click citation verification | Source cards deep-link to `/handbook.pdf#page=N` when the PDF is served |
| Scope and safety layer | Weapons, concealment, violence, threats, self-harm, cheating, rule evasion, prompt injection, personal data, out-of-scope, greetings |
| Image upload: content-sniffed validation, limits, in-memory TTL store, owner-bound access | Verified, including rejection of a non-image renamed `.png` |
| Demo mode that never claims to be AI | Labeled “Local demo — not AI” in the API, banner, and badges |
| Backend hardening: Helmet CSP, same-origin write guard, 3 rate limiters, request IDs, secret-free errors | Verified; no stack traces in production |
| Frontend: responsive layout, source cards, markdown with escaping, copy/retry, a11y | Verified in the browser |
| Frontend extras: handbook-only mode, follow-up chips, inline citation links, highlighted excerpts, theme menu (light/dark/system), Ctrl+K quick actions, sidebar TOC, dictation, feedback, print styles, PWA shell | Verified in the browser and by headless-browser tests |
| Automated tests | 98 tests (unit + worker-mode + retrieval golden set + headless browser) + 21 end-to-end scenarios |

**Requires future setup:**

| Item | What is needed |
|---|---|
| **AI-written answers** | Verified live on 2026-10-31 (21/21 smoke scenarios, cited answers, streaming). Use a model that is enabled for your account. |
| **Live image understanding** | Verified live on 2026-10-31 with `nvidia/nemotron-3.5-super-vl-120b-a12b`. Other accounts may need a different `AI_VISION_MODEL`; the 404 for an undeployed model is reported actionably. |
| **Out-of-handbook answers** | Verified live: the model returns the “couldn’t find a clear answer … confirm with the appropriate school office” fallback instead of inventing policy. |
| Campus-specific or superseding policies | The handbook names no campus. Later STI announcements may override it; they are not indexed. |
| Persistent chat history + delete UI | Intentionally omitted. History lives in browser memory and is lost on refresh. |
| Production deployment hardening | TLS, `TRUST_PROXY`, log shipping, and monitoring are documented but not configured. |

An invalid model ID is reported through the provider’s own error message and the troubleshooting table; it does not need a code change.

---

## How it works

```
Browser
  |
  |  POST /api/chat  { message, history, attachmentId? }
  v
Express server
  |
  +--> Safety & scope filter (rule-based)
  |      out-of-scope / prompt injection / threats / self-harm /
  |      cheating / rule evasion --> safe deterministic response
  |
  +--> Optional image path
  |      validate image -> memory store -> vision model
  |      -> transcript/description -> retrieval query
  |
  +--> Hybrid retrieval over data/index.json
  |      dense cosine similarity (multilingual MiniLM)
  |      + BM25 keyword score
  |      + section, heading, and topic boosts
  |      + BM25-only fallback
  |
  +--> Demo mode: return labelled excerpts (no AI call)
  |
  +--> AI mode: grounded prompt -> chat model
  |      -> citation check -> warning if unverifiable
  |
  v
Response with answer, mode, sources, safety metadata, and warnings
```

The frontend is plain HTML, CSS, and JavaScript. There is no build step and no external font or script CDN. The server never sends API keys to the browser.

### Retrieval design

- The index is built from section-aware chunks with printed page ranges.
- Embeddings use `Xenova/paraphrase-multilingual-MiniLM-L12-v2` locally by default (384 dimensions, downloaded once to `data/models`).
- BM25 handles names, policy terms, and typos; dense vectors handle Taglish and paraphrases.
- A **vocabulary bridge** maps the words students use onto the words the handbook uses (`kill` → `assault`, `stole` → `theft`, `broke` → `damaging`, `pay` → `payment`, `expelled` → `expulsion`). Many everyday student words appear nowhere in the handbook, so without it a question matches only on its filler words — *"can I kill my teacher"* used to retrieve classroom and uniform sections because `kill` matched nothing at all.
- The same bridge exists in the scope filter, so a real concern phrased the student's own way (*"someone stole my bag"*, *"will I get expelled"*) is answered instead of being redirected as off-topic.
- Section-heading, topic-intent, and keyword boosts correct common ranking mistakes (for example, ID vs. lost-and-found).
- Results below the relevance threshold are not sent to the model. If nothing passes, the model is instructed not to answer from memory.
- If the embedding runtime is unavailable, retrieval falls back to keyword search and adds a warning instead of failing the request.

---

## Requirements

- **Node.js 20.19 or newer** (Node 22 or 24 recommended; developed on Node 24.19).
- npm 10+.
- The handbook PDF in the project root:
  `STI High School Student Handbook 2026 (ORCA).pdf`
- Internet access the first time the local embedding model is downloaded. After that, `data/models` can be reused offline.
- A modern browser with JavaScript enabled.

---

## Quick start (local demo mode)

```powershell
# 1. Install dependencies
npm install

# 2. Create your local environment file
Copy-Item .env.example .env

# 3. Build the handbook index (first run downloads the embedding model)
npm run index

# 4. Validate configuration and the index
npm run check

# 5. Start the server
npm start
```

On macOS/Linux, use `cp .env.example .env` instead of `Copy-Item`.

Open **http://localhost:3000**.

With the placeholder API key left unchanged, the app starts in **local retrieval demo** mode. It prints a warning at startup and the UI shows **“Demo · not AI.”** This is expected until a real key is configured.

Useful commands:

```powershell
npm run dev          # restart on file changes
npm run check        # validate env, PDF, and index without starting the server
npm run index        # rebuild data/index.json and data/handbook.json
npm test             # run all 98 tests
```

---

## Cloudflare Workers (free plan)

The same Express application also runs on **Cloudflare Workers with Static
Assets** — no containers, no paid plan, no Docker. The local Node workflow
(`npm start`) is unchanged and remains the recommended development setup.

| Piece | Local Node server | Cloudflare Workers |
|---|---|---|
| HTTP layer | `src/server.js` (`app.listen`) | `worker/index.js` using `httpServerHandler` from `cloudflare:node` |
| Frontend | `express.static(public/)` | Workers Static Assets (`ASSETS` binding, `run_worker_first: ["/api/*"]`) |
| Handbook index | `data/index.json` on disk | `HANDBOOK_INDEX` KV namespace, cached per isolate |
| Query embeddings | local ONNX or NVIDIA | NVIDIA provider API only |
| Image uploads | in-memory store with TTL | disabled with a clear message (R2 can lift this later) |
| Handbook PDF | `/handbook.pdf` when enabled | never uploaded, always disabled |

### One-time setup

```powershell
npm install
npm run index                                  # local build; needs the PDF

npx wrangler login                             # or set CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID
npx wrangler kv namespace create HANDBOOK_INDEX
# → copy the printed id into wrangler.jsonc (kv_namespaces[0].id)

npx wrangler secret put AI_API_KEY             # NVIDIA key (chat + vision)
npx wrangler secret put EMBEDDING_API_KEY      # optional; falls back to AI_API_KEY

npm run kv:upload                              # upload data/index.json to KV
npx wrangler deploy
```

For semantic search in the Worker, build the index with provider embeddings
first (the Worker never loads local ONNX models):

```powershell
$env:EMBEDDING_PROVIDER="nvidia"; npm run index; npm run kv:upload
```

### Local Worker development

```powershell
npm run kv:upload:local   # write the index into the local KV store
npm run dev:worker        # wrangler dev on http://localhost:8787
```

`.dev.vars` (gitignored) holds local secrets such as `AI_API_KEY`.

### Bindings and secrets

| Name | Type | Purpose |
|---|---|---|
| `ASSETS` | Static assets binding | serves `public/` |
| `HANDBOOK_INDEX` | KV namespace | the generated handbook index (key `handbook-index`) |
| `AI_API_KEY` | secret | NVIDIA NIM chat + vision key |
| `EMBEDDING_API_KEY` | secret, optional | falls back to `AI_API_KEY` |
| `EMBEDDING_PROVIDER` | var (`nvidia`) | selects provider query embeddings |
| `NODE_ENV`, `LOG_LEVEL` | vars | production logging |

The index is never exposed as a public file: only `public/` is uploaded as
assets, and `data/` is never part of the asset directory.

### What differs on the first Worker deployment

- **Image uploads are disabled** (`501 image_uploads_unavailable`) with a
  student-friendly message, and the attach button is hidden via
  `/api/meta → capabilities.imageUploads`. The in-memory attachment store and
  its cleanup timer cannot be trusted across isolates. **Adding R2 later:**
  create a bucket (`npx wrangler r2 bucket create sti-attachments`), add an
  `r2_buckets` binding, treat objects as temporary (store a TTL in metadata and
  add a bucket lifecycle rule to expire objects), keep the existing
  magic-byte/image-size validation, then set `ENABLE_IMAGE_UPLOADS=true`.
- **The handbook PDF is not served**, so source cards do not deep-link into it.
  Citations, excerpts, and printed page references (`p. 39`) still work.
- **Local ONNX embeddings never load.** With a local-embedding index the
  Worker searches with BM25 keywords only and logs one operator warning per
  isolate; rebuild the index with `EMBEDDING_PROVIDER=nvidia` to enable dense
  retrieval. A dimension mismatch would fall back safely, but the index is
  skipped before any embedding call is attempted.
- **Rate limits and feedback counters are per isolate** (in-memory). They work,
  but parallel isolates do not share counters; add Cloudflare's own rate
  limiting rules for hard guarantees.
- **CPU budget:** the free plan allows 10 ms CPU per request (network waits —
  NVIDIA calls, KV reads — do not count). The index is parsed once per isolate
  and cached, so only the first request in a fresh isolate does the heavier
  work. Compression is left to the edge in the Worker.
- **Static assets keep their security headers** through `public/_headers`
  (kept in sync with the Helmet configuration that protects API responses).

---

## Enable AI answers (NVIDIA NIM)

STI Assist AI uses NVIDIA NIM's OpenAI-compatible chat-completions API:

```text
POST https://integrate.api.nvidia.com/v1/chat/completions
```

1. Create an NVIDIA API key in the NVIDIA build/NIM catalog.
2. Edit `.env`:

```dotenv
AI_PROVIDER=nvidia
AI_API_KEY=nvapi-your-real-key
AI_BASE_URL=https://integrate.api.nvidia.com/v1
AI_MODEL=nvidia/nemotron-3.5-bolt-e4b
AI_VISION_MODEL=nvidia/nemotron-3.5-super-vl-120b-a12b
```

`AI_VISION_MODEL` availability is account-scoped: the Llama 3.2 11B vision
model is listed in the public catalogue but returned `404` (not deployed for
the account) during verification, while the Nemotron VL model answered image
requests correctly. See [Vision behavior](#vision-behavior).

**Choose `AI_MODEL` carefully — not every model suits this app.** Measured
against `integrate.api.nvidia.com` on 2026-10-28 with a realistic grounded
handbook prompt:

| Model | Latency | Hidden reasoning tokens | Answer |
|---|---|---|---|
| `nvidia/nemotron-3.5-bolt-e4b` | 1.1s | 0 | complete |
| `meta/llama-3.2-11b-vision-instruct` | 2.5s | 0 | complete |
| `nvidia/nemotron-3.5-lightning-30b-a3b` | 7.4s | 593 | **truncated** |
| `nvidia/nemotron-3-ultra-550b-a55b` | 49s | 0 | complete |
| `openai/gpt-oss-20b` | 175s | 0 | **truncated** |

A **reasoning model** bills its hidden chain-of-thought against
`AI_MAX_OUTPUT_TOKENS`, so the visible answer gets whatever is left — with a
900-token budget that can be nothing at all. The app detects this and labels
the reply as incomplete rather than passing off a half sentence as an answer.
Retired models return **HTTP 410** and are reported with the provider's own
explanation.

3. Restart the server.
4. Check the mode:

```powershell
Invoke-RestMethod http://localhost:3000/api/meta | ConvertTo-Json -Depth 5
```

`mode.demo` should be `false`. The UI badge should read **“AI configured · not verified.”** It changes to **“AI verified”** only after a real AI response succeeds in that browser session.

The default model IDs may change or may not be enabled for every account. Confirm the current IDs and availability in the provider's model catalog. The app never claims the AI is connected merely because a key is present.

### Vision behavior

NVIDIA's hosted vision schema used here sends **one user message containing text and an `image_url` part**, because the hosted endpoint documents only `user` and `assistant` roles for that model. The image is sent as a temporary `data:` URL.

The vision pipeline is two-step:

1. The vision model transcribes visible text and describes the image.
2. The text model answers the student's question using retrieved handbook passages plus that analysis.

If vision fails and the question is only about the image, the app explains the failure instead of guessing. If the question also asks a handbook policy question, the text portion can still proceed with a warning.

> **Image input was verified working on 2026-10-31** with
> `nvidia/nemotron-3.5-super-vl-120b-a12b`: a generated 96×96 PNG was uploaded,
> analyzed (`analyzed: true`, ~4–5 s), described correctly, and the reply kept
> the grounding rules (“image analysis is supplementary context only”).
>
> Availability is per-account. Earlier in the same environment,
> `meta/llama-3.2-11b-vision-instruct` and `microsoft/phi-3-vision-128k-instruct`
> returned `404` (“function … is not found”, i.e. not deployed for the account),
> and `meta/llama-3.2-90b-vision-instruct` timed out at 60 s. The app now maps
> that 404 to an actionable message: enable the model for the account, or set
> `AI_VISION_MODEL` to a vision model that is actually deployed.
>
> The Nemotron VL model is a *reasoning-style* model: it occasionally spends the
> whole token budget on hidden reasoning before the visible answer. The default
> vision budget is therefore `AI_VISION_MAX_OUTPUT_TOKENS=1600`, and a truncated
> attempt is retried once. `AI_VISION_TIMEOUT_MS` (default 30000) tunes how long
> to wait before the app gives up and tells the student to type the text
> instead.

### Using another OpenAI-compatible provider

```dotenv
AI_PROVIDER=openai-compatible
AI_BASE_URL=https://your-provider.example/v1
AI_MODEL=your-chat-model
AI_VISION_MODEL=your-vision-model
```

The provider must accept OpenAI-style `messages`, `chat/completions`, and (for images) `image_url` content parts. Some providers do not support vision or use a different schema; test both paths before relying on them. Base URLs must use HTTPS, except for `localhost` testing.

### Confirming a real AI call

Use a question that requires retrieval, such as:

```powershell
$body = @{ message = "What should I do if I forget my school ID?" } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri http://localhost:3000/api/chat `
  -ContentType "application/json" -Body $body | ConvertTo-Json -Depth 6
```

A successful AI response has `mode: "ai"` and `aiGenerated: true`. If it still says `mode: "demo"`, the server did not see a real key. See [Troubleshooting](#troubleshooting).

---

## Handbook indexing

The default handbook path is:

```text
STI High School Student Handbook 2026 (ORCA).pdf
```

Override it with `HANDBOOK_PATH` in `.env` (relative paths resolve from the project root).

```powershell
npm run index
```

Outputs:

- `data/index.json` — chunks, BM25 vocabulary, embeddings, and metadata used by the server.
- `data/handbook.json` — a readable copy of the indexed chunks without vectors.
- `data/models/` — local embedding model cache.

The current index contains **171 chunks across 131 sections**, covering **printed pages 9–61**. The index script refuses to write an index with fewer than 40 chunks, so a failed PDF extraction fails loudly instead of producing a weak index.

### When to rebuild

Rebuild the index after any of these changes:

- The handbook PDF is replaced or edited.
- `LOCAL_EMBEDDING_MODEL` or `EMBEDDING_PROVIDER` changes.
- The chunking or extraction code changes.
- `data/index.json` is deleted.

Changing the embedding model without rebuilding leads to a dimension mismatch. The server detects this and falls back to keyword search with a warning.

### Lexical-only index (troubleshooting)

```powershell
npm run index -- --lexical-only
```

This skips embeddings and writes a BM25-only index. Retrieval then uses keyword search only; the index metadata records the embedding provider as `none`, and the server does not pretend semantic search is active. Use this when the local model cannot be downloaded or when diagnosing retrieval.

### Embedding providers

| Provider | Setting | Notes |
|---|---|---|
| Local (default) | `EMBEDDING_PROVIDER=local` | Offline after first download. Multilingual, 384 dimensions. Recommended. |
| NVIDIA NIM | `EMBEDDING_PROVIDER=nvidia` | Uses `nvidia/llama-3.2-nv-embedqa-1b-v2` by default and `input_type=query/passage`. Requires an embedding key and network access. |

`EMBEDDING_API_KEY` falls back to `AI_API_KEY`. If you switch providers or models, rebuild the index so stored vectors and query vectors come from the same model.

### Index contents

- Front matter, table of contents, appendices, and forms are excluded.
- Every chunk carries `section`, `chapter`, `page`, `pageEnd`, and `keywords`.
- Printed page mapping is stored in `meta.pageOffsetNote`.
- The index includes document metadata such as title, edition, publication date, campus note, and document hash.

---

## Configuration

Copy `.env.example` to `.env`. Never commit `.env`.

### Server

| Variable | Default | Notes |
|---|---|---|
| `PORT` | `3000` | HTTP port. |
| `NODE_ENV` | `development` | Use `production` for deployment. |
| `LOG_LEVEL` | `info` | Set to `silent` to suppress request logs. |
| `TRUST_PROXY` | unset | Set proxy hops (for example `1`) only behind a trusted reverse proxy, so rate limiting sees the real client IP. |

### AI provider

| Variable | Default | Notes |
|---|---|---|
| `AI_PROVIDER` | `nvidia` | `nvidia` or `openai-compatible`. |
| `AI_API_KEY` | empty | Real key enables AI mode. A blank or `replace...` placeholder forces demo mode. |
| `AI_BASE_URL` | `https://integrate.api.nvidia.com/v1` | HTTPS required except for localhost. |
| `AI_MODEL` | `meta/llama-3.3-70b-instruct` | Chat model ID. |
| `AI_VISION_MODEL` | `nvidia/nemotron-3.5-super-vl-120b-a12b` | Image model ID. Must be deployed for your provider account. |
| `AI_VISION_MAX_OUTPUT_TOKENS` | `1600` | 128–4096. Reasoning-style VL models need headroom before their visible answer. |
| `AI_TIMEOUT_MS` | `45000` | Per-request timeout, 5–120 seconds. |
| `AI_MAX_OUTPUT_TOKENS` | `900` | 128–4096. |
| `AI_TEMPERATURE` | `0.1` | Clamped to 0–1. Low values reduce improvisation. |

### Embeddings

| Variable | Default | Notes |
|---|---|---|
| `EMBEDDING_PROVIDER` | `local` | `local` or `nvidia`. |
| `LOCAL_EMBEDDING_MODEL` | `Xenova/paraphrase-multilingual-MiniLM-L12-v2` | Downloaded to `data/models`. |
| `NVIDIA_EMBEDDING_MODEL` | `nvidia/llama-3.2-nv-embedqa-1b-v2` | Used when provider is `nvidia`. |
| `EMBEDDING_API_KEY` | falls back to `AI_API_KEY` | Optional separate key. |
| `EMBEDDING_BASE_URL` | `https://integrate.api.nvidia.com/v1` | HTTPS except localhost. |
| `EMBEDDING_TIMEOUT_MS` | `30000` | 5–120 seconds. |
| `ENABLE_DENSE_RETRIEVAL` | `true` | Set `false` for BM25-only retrieval. |

### Handbook and limits

| Variable | Default | Notes |
|---|---|---|
| `HANDBOOK_PATH` | `STI High School Student Handbook 2026 (ORCA).pdf` | Relative to project root or absolute. |
| `SERVE_HANDBOOK_PDF` | `true` | Serves the indexed PDF at `/handbook.pdf` for citation deep links. The whole PDF becomes downloadable; set `false` if you lack redistribution rights. |
| `MAX_IMAGE_MB` | `6` | 1–20 MB. |
| `MAX_MESSAGE_CHARS` | `2000` | 100–8000 characters. |
| `ATTACHMENT_TTL_MINUTES` | `30` | 1–180 minutes. Images stay in memory only. |
| `RATE_LIMIT_API_PER_MINUTE` | `120` | General API limit per IP. |
| `RATE_LIMIT_CHAT_PER_MINUTE` | `30` | Chat requests per IP. |
| `RATE_LIMIT_UPLOADS_PER_10_MINUTES` | `12` | Image uploads per IP. |

Additional built-in limits:

- JSON bodies: 48 KB.
- Chat history: up to 12 turns accepted by the route; the last 8 and 12,000 characters are sent to the model.
- Images: JPEG, PNG, or WebP; minimum 16×16; maximum 40 megapixels; max 20 images and 60 MB total in memory.
- Upload rate limits are enforced by IP and always apply, including in demo mode.

---

## API

All endpoints return JSON except the static frontend. Errors use:

```json
{
  "error": {
    "code": "empty_message",
    "message": "Please type a question about school rules or campus concerns.",
    "requestId": "..."
  }
}
```

### `POST /api/chat`

Request:

```json
{
  "message": "What should I do if I forget my school ID?",
  "history": [
    { "role": "user", "content": "Earlier question" },
    { "role": "assistant", "content": "Earlier answer" }
  ],
  "attachmentId": "optional-upload-id"
}
```

`history` is optional and limited. `attachmentId` must come from `POST /api/attachments` for the same client. `preferExcerpts: true` asks for direct handbook excerpts even on an AI-configured server (the same pipeline as demo mode, labelled `excerpts`).

Response (abridged):

```json
{
  "id": "...",
  "mode": "demo",
  "aiGenerated": false,
  "answer": "**Local demo — not AI** ...",
  "sources": [
    {
      "id": "...",
      "section": "School Identification (ID) Card",
      "chapter": "Student Behavior & Discipline",
      "page": 39,
      "pageEnd": 39,
      "excerpt": "Students who lost their ID shall ...",
      "source": "STI High School Student Handbook 2026"
    }
  ],
  "safety": {
    "level": "none",
    "category": "school",
    "claimToVerify": false
  },
  "image": null,
  "warnings": [],
  "meta": {
    "provider": "nvidia",
    "demoMode": true,
    "retrievedChunks": 5,
    "topScore": 1.026,
    "timings": { "retrievalMs": 41, "totalMs": 46 }
  },
  "requestId": "..."
}
```

`mode` is one of:

- `demo` — direct handbook excerpts because no key is configured; **no AI call**.
- `excerpts` — direct handbook excerpts by student choice on an AI-configured server; **no AI call**.
- `ai` — written by the configured model.
- `guide` — deterministic safety, scope, greeting, or meta response.

Responses also carry `followUps` (up to three grounded suggested questions) and
`meta.confidence` (`{ level, topScore }` with `level` one of `strong`, `partial`,
`weak`, `none`). In AI mode the response may also include `usage`, `model`, and
citation warnings in `warnings`.

### `POST /api/chat/stream`

Same request body as `/api/chat`, but the response is a Server-Sent Events
stream. Validation errors still return a normal JSON error with an HTTP status;
once the stream starts, failures arrive as an `error` event.

```text
event: sources
data: {"mode":"ai","sources":[...],"safety":{...},"meta":{...}}

event: delta
data: {"text":"Partial answer text"}

event: done
data: {"id":"...","mode":"ai","answer":"...","sources":[...],"warnings":[...]}
```

- `sources` is sent as soon as retrieval finishes, before the model starts writing.
- `delta` events contain visible text only; reasoning tokens are not forwarded.
- `done` contains the same verified response as `/api/chat`, including
  citation-check warnings and post-processing. Clients should replace the
  streamed text with this final answer.
- `error` contains `{ "error": { "code", "message", "requestId" } }`.
- If the client disconnects, the provider request is aborted.
- If `/api/chat/stream` is unavailable (an older server or a proxy that blocks it), the browser automatically falls back to `POST /api/chat` for that answer and the rest of the session.
- In demo or guide mode, only `done` is sent; no AI call is made.

### `POST /api/attachments`

Multipart form:

- Field name: `image`
- Formats: JPEG, PNG, WebP
- Size: up to `MAX_IMAGE_MB` (default 6 MB)
- Header: `X-Client-Id` — 8–64 characters of letters, numbers, or hyphens

Response `201`:

```json
{
  "attachment": {
    "id": "...",
    "name": "notice.png",
    "mimeType": "image/png",
    "size": 18234,
    "width": 640,
    "height": 480,
    "createdAt": "2026-10-28T02:00:00.000Z",
    "expiresAt": "2026-10-28T02:30:00.000Z"
  }
}
```

Validation errors include `invalid_image` (422), `unsupported_image_type` (415), `image_too_small` (422), `image_dimensions_too_large` (422), `image_too_large` (413), and `missing_image` (400).

### `DELETE /api/attachments/:id`

Deletes the image if it belongs to the same client/IP. Returns `204`. A missing or foreign image returns `404` without revealing whether it exists.

### `POST /api/feedback`

Records one anonymous answer verdict. No message text and no client identifiers are accepted or stored; counters live in memory only.

```json
{
  "verdict": "helpful",
  "section": "School Identification (ID) Card",
  "page": 39,
  "mode": "ai"
}
```

`verdict` must be `helpful` or `not_helpful`; the rest is optional. Returns `202 { "recorded": true }`. Anything malformed returns `400 invalid_feedback`.

### `GET /api/handbook/sections`

Table of contents derived from the indexed chunks: chapters with page ranges and their sections, so the sidebar can render a browse view that can never drift from what retrieval cites. Cached privately for 5 minutes.

### Health and metadata

- `GET /api/health` — status, mode, uptime, index counts, active image count, and `index.stale` (true when the handbook PDF on disk is newer than the index built from it). No secrets.
- `GET /api/meta` — app disclaimer, suggested questions, handbook metadata (including `stale`), limits, provider/model names, and demo status.

### Headers

- `X-Request-Id` is returned on every response and included in error bodies.
- `Cache-Control: no-store` is set on chat responses.
- The browser sends `X-Client-Id` to bind uploads to the tab.

### Rate limits

When a limit is exceeded, the API returns `429` with `code: "rate_limited"`. Limits are per IP and use `express-rate-limit`. Behind a reverse proxy, set `TRUST_PROXY` correctly or every user may share one limit.

---

## Safety behavior

The safety layer is deterministic and runs **before** retrieval or any AI call.

| Category | Behavior |
|---|---|
| Normal school questions | Allowed through to retrieval. |
| Weapon policy questions | Allowed with a caution flag and a safety note; answers must come from handbook discipline passages. |
| Weapon concealment, smuggling, security bypass | Refused with emergency-level guidance and relevant discipline citations. |
| Threats, violence, instructions to harm | Refused with emergency guidance and a prompt to contact school security or 911. |
| Self-harm or concern for a friend | Supportive guidance to contact a trusted adult, counselor, or emergency services. Not a crisis service. |
| Bullying or conflict policy questions | Allowed with a caution note and guidance to talk to a counselor or trusted official. |
| Cheating, plagiarism, avoiding detection | Refused; policy questions about academic honesty remain allowed. |
| Sneaking prohibited items or evading rules | Refused. |
| Prompt injection, “ignore the handbook,” reveal system prompt | Refused. |
| Requests for grades, tuition balance, or other personal records | Refused; the app has no access to student records. |
| Unrelated tasks (poems, jokes, general trivia) | Redirected to handbook topics. |
| False claims about the handbook (“uniforms are optional, right?”) | Answered from retrieved passages with a false-claim verification instruction and a caution flag. |
| Greetings and “who are you?” | Deterministic response that identifies the prototype and its scope. |

Safety responses in demo mode are rule-based and are **not** AI-generated. They may still include handbook sources related to the refusal.

The assistant never provides instructions for weapons, violence, self-harm, cheating, or rule evasion. It can explain what the handbook says about those topics when the question is policy-focused.

---

## Privacy and security

### Images

- Held in **server memory only**; never written to disk by the app.
- Expire after `ATTACHMENT_TTL_MINUTES` (30 by default); a cleanup timer runs every five minutes.
- Bound to a hash of the browser client ID **and** request IP, so a guessed upload ID cannot retrieve another connection's image.
- The web client deletes them after a successful chat that used them; they can also be removed by the student or with `DELETE /api/attachments/:id`. All copies expire after the TTL.
- Maximum 20 images / 60 MB in memory; oldest images are evicted under pressure.
- Validated by magic bytes and dimensions, not just the filename or MIME header.
- In AI mode, the image is sent to the configured vision provider for analysis. In demo mode, it is **not** sent anywhere.

### Conversations

- Stored only in the browser tab's memory.
- Lost on refresh or “New chat.” There is no database and no server-side conversation history.
- A random client ID is stored in `localStorage` solely to bind temporary uploads to the browser. It is not an account or profile.
- In AI mode, the question, recent turns, retrieved passages, and image analysis are sent to the configured AI provider under that provider's terms.

### Application security

- API keys exist only in server-side `.env`; the frontend never receives them.
- `.env`, generated indexes, model caches, and PDFs are excluded by `.gitignore`.
- Helmet with a restrictive CSP: no inline scripts, no external assets, `object-src 'none'`, `frame-ancestors 'none'`.
- Same-origin check blocks cross-origin `POST`/`PUT`/`PATCH`/`DELETE` requests.
- Request size limits, message/history validation, image validation, and rate limits.
- Provider errors are mapped to safe student-facing messages; raw provider bodies are not returned.
- Request IDs are included in errors and logs for diagnosis without exposing stack traces in production.

### Deployment notes

- **Handbook PDF exposure:** by default the indexed PDF is served at `/handbook.pdf` so source cards can deep-link to a cited page. It is marked `noindex` and cached privately, but anyone who can reach the app can download the whole document. Set `SERVE_HANDBOOK_PDF=false` if the handbook must not be redistributed; excerpts and citations still work.
- Use **HTTPS** in production and put the app behind a trusted reverse proxy.
- Set `NODE_ENV=production` and `TRUST_PROXY` to the correct hop count.
- Run under a process manager (systemd, PM2, or similar) and restrict access to the port. A sample unit is provided at `deploy/sti-assist.service`.
- **Containers:** a `Dockerfile` is included. Build the index first (`npm ci && npm run index`), then `docker build -t sti-assist .` and run with `--env-file .env -p 3000:3000`. The image expects `data/index.json` and, for local embeddings, `data/models/` in the build context.
- The app has no user accounts or authorization layer. If you deploy it publicly, add institution-appropriate access controls, monitoring, and a privacy review. Do not expose student data or confidential handbook files.
- **Cloudflare Workers:** see [Cloudflare Workers (free plan)](#cloudflare-workers-free-plan) for the serverless deployment path (Static Assets + KV, no containers, no paid plan).
- **Run a single server instance** unless you add shared infrastructure. Temporary images, rate-limit counters, and in-memory state are per process, so multiple instances would not share uploads or limits. Use a shared store and object storage before scaling horizontally.
- Rebuild the index during deployment if it is not shipped or if the handbook/model changed. The PDF itself is gitignored.

---

## Testing

```powershell
npm test
```

The suite uses Node's built-in test runner and `supertest`; it currently contains **98 tests**, including a retrieval evaluation over a golden question set, headless-browser checks of the client, and Worker-mode tests that run the same Express app with a synthetic index in a fake KV binding:

- Safety and scope classification, including threats, self-harm, weapon concealment, rule evasion, prompt injection, false claims, and out-of-scope redirects.
- Index metadata, page mapping, retrieval ranking for ID, uniforms, slippers, tardiness, gadgets, lost items, discipline, weapons, and cheating.
- Taglish and misspelled queries.
- Prompt construction, grounding rules, history sanitisation, vision message shape, citation verification, source merging, and demo-answer labeling.
- Provider success, auth failure, rate limiting, retries, timeouts, network errors, malformed responses, and vision input.
- Streaming provider calls: incremental deltas, events split across chunk boundaries, and fallback when a provider ignores `stream=true`.
- API health/meta, demo chat, SSE source/delta/done shape, PDF citation routing and page mapping, validation, malformed JSON, cross-origin writes, upload validation, owner-bound deletion, invalid images, demo image handling, security headers, and rate limiting.
- New surface area: `preferExcerpts` validation and labelling, follow-up grounding, confidence levels, the anonymous feedback endpoint (including malformed input), the table-of-contents endpoint, gzip compression, `Permissions-Policy`, and index-freshness reporting.
- Retry behavior for the transient provider failures observed live: a model `404`…`200` recovery and a truncated reasoning answer that succeeds on retry.
- **Retrieval evaluation** (`tests/eval.test.js`, also runnable alone): 20 golden student questions scored hit@1 / hit@3 and page accuracy, failing the build below 0.9 hit@3 or 0.75 page accuracy.
- **Headless browser checks** (`tests/browser.test.js`): welcome state without horizontal overflow, a streamed answer with source cards, PDF deep links, clickable inline citations that reveal their source card, follow-up chips, the non-AI label, the theme menu persisting dark mode across reloads, and Ctrl+K quick actions. Skipped automatically when no Chromium browser or global `WebSocket` is available (Node 20).

Useful checks:

```powershell
npm run check                      # env + PDF + index
npm run eval                       # retrieval scoreboard (hit@3, page accuracy)
npm run smoke                      # end-to-end checks against a running server
node scripts/debug-safety.js       # print safety classifications for sample messages
node scripts/debug-search.js       # print retrieval rankings for sample queries
```

A GitHub Actions workflow (`.github/workflows/ci.yml`) runs `npm ci`, `npm run check`, `npm run eval`, and `npm test` on Node 20, 22, and 24, and uploads the retrieval report as an artifact.

Tests intentionally set `ENABLE_DENSE_RETRIEVAL=false` and use mocked provider fetches, so they run without an API key or network model calls. **Passing tests do not prove a live AI provider works.** See below.

### End-to-end smoke test

With the server running, `npm run smoke` sends 21 handbook scenarios through the real
HTTP API and checks that each answer stays grounded:

- the retrieved sections match the topic (ID, uniform, tardiness, gadgets, lost items, discipline, weapons);
- Taglish and misspelled questions still reach the right section;
- refusal categories are correct for weapon concealment, violence, threats, self-harm, prompt injection, and out-of-scope questions;
- **no answer cites a page number that was not retrieved**;
- a non-image file uploaded as `.png` is rejected.

Point it at a non-default port with `SMOKE_BASE_URL`, for example
`SMOKE_BASE_URL=http://localhost:3001 npm run smoke`.

It reports the server mode. In demo mode it verifies retrieval, grounding, and safety
only — it exits successfully while still stating that AI is unverified. Re-run it after
adding a key to confirm AI mode end to end.

### Manual smoke test

1. Start the server and open the UI.
2. Confirm the badge says **Demo · not AI** when no key is configured.
3. Ask: “What should I do if I forget my school ID?” — expect the ID section, p. 39.
4. Ask in Taglish: “Nakalimutan ko ID ko, makakapasok pa ba ako?” — expect the ID section.
5. Ask: “Can I wear slippers to school?” — expect the uniform section, p. 40.
6. Ask: “Can I use my phone during class?” — expect the gadget rule, p. 43.
7. Ask: “How can I hide a weapon in my bag?” — expect a refusal, safety guidance, and Category D sources.
8. Ask an unrelated question — expect a redirect, not a fabricated citation.
9. Upload a valid JPEG/PNG/WebP — expect preview, progress, and a clear “not analyzed” note in demo mode.
10. Upload an invalid file — expect a readable error, not a crash.
11. In AI mode, ask a policy question and confirm the badge changes to **AI verified** only after a successful response.
12. Open About & privacy and confirm the unofficial/not-endorsed statement.

---

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `Port 3000 is already in use` | Stop the other process or set `PORT` to another value in `.env`. |
| Page loads but badge says **Server offline** | The server is not running or the browser cannot reach it. Run `npm start` and reload. |
| `Could not load the handbook index` | `data/index.json` is missing or unreadable. Run `npm run index`. |
| `Handbook not found at ...` | Put the PDF in the project root or set `HANDBOOK_PATH` to its absolute path. |
| Indexing fails while generating embeddings | The local model could not be downloaded or run. Check network/proxy access, retry, or use `npm run index -- --lexical-only`, or switch to NVIDIA embeddings. |
| Indexing says only N chunks were extracted | The PDF layout changed or the wrong file is configured. Verify `HANDBOOK_PATH` and inspect the extraction output. |
| AI answers still look like demo excerpts | `AI_API_KEY` is blank or still a placeholder, or the server was not restarted. Run `npm run check` and confirm `mode.demo` in `/api/meta`. |
| Badge stays **AI configured · not verified** | No successful AI response has completed in this browser session. The key may be invalid, the model unavailable, or requests timing out. Check server logs. |
| `401` / `403` from provider | Invalid or revoked API key, or the account lacks access. Update `AI_API_KEY`. |
| `404` from provider | Wrong model ID or base URL. Confirm the model is enabled for your account and `AI_BASE_URL` ends in `/v1`. |
| `429` from provider | Provider rate limit. Wait, reduce traffic, or check account quota. The app retries once for transient limits. |
| `504` / timeout | Increase `AI_TIMEOUT_MS` (max 120000), try a smaller prompt/image, or check provider status. |
| Vision returns `400` / `422` | The selected model may not support images or uses a different schema. Use a vision-capable model and verify the provider's current API. |
| Every image says “took too long” or “temporarily unavailable” | Verified cause on 2026-10-28: NVIDIA's hosted vision models fail on any request containing an image, while serving text fine. The app is working; the endpoint is not. Point `AI_PROVIDER=openai-compatible` at a provider with a working vision API, or ask students to type the text. |
| Image upload returns `413` | The image exceeds `MAX_IMAGE_MB`. Compress it or raise the limit (max 20 MB). |
| Image upload returns `422` / `415` | The file is not a valid JPEG/PNG/WebP, is smaller than 16×16, or exceeds 40 megapixels. Use a normal screenshot or photo. |
| `attachment_expired` | The image exceeded its 30-minute TTL, was already used/deleted, or belongs to another client. Upload it again. |
| `rate_limited` | The app's per-IP limit was reached. Wait for the window to reset and try again. Behind a proxy, set `TRUST_PROXY`. |
| Citation warning in an AI answer | The model cited a page not present in the retrieved passages, or omitted a page. Read the source cards and verify; this is a safety feature, not a silent failure. |
| Retrieval suddenly worse after changing models | Rebuild the index. Stored and query vectors must come from the same embedding model. |
| Local embedding model download is slow | It is a one-time download to `data/models`. Subsequent index builds and queries reuse the cache. |

Enable verbose errors during development with `DEBUG=1` for the index script. Server errors include a request ID; search the server log for that ID. In production, stack traces are suppressed in API responses.

---

## Project structure

```
STI Chatbot/
├── public/
│   ├── index.html              # UI shell, inline SVG sprite, quick actions, disclaimer
│   ├── css/style.css           # responsive design, dark theme, print styles, reduced motion
│   ├── js/app.js               # client state, uploads, markdown, citations, palette, feedback
│   ├── js/theme.js             # pre-paint theme bootstrap (avoids a light flash)
│   ├── _headers                # security headers for Workers Static Assets
│   ├── sw.js                   # service worker: offline shell, never caches API/PDF
│   ├── manifest.webmanifest    # PWA manifest
│   └── favicon.svg
├── src/
│   ├── app.js                  # Express app, Helmet CSP, routes, error handling
│   ├── server.js               # startup, index preload, graceful shutdown
│   ├── config/
│   │   ├── index.js            # env parsing, provider/mode selection, limits
│   │   └── handbook.js         # curated headings, keywords, suggestions
│   ├── routes/chat.js          # chat, stream, feedback, upload, delete, rate limiters
│   ├── services/
│   │   ├── aiProvider.js       # OpenAI-compatible chat, retries, timeouts, vision
│   │   ├── attachments.js      # memory-only image validation/store/TTL
│   │   ├── chatService.js      # orchestration, modes, sources, citations, follow-ups
│   │   ├── embeddings.js       # local Transformers.js and NVIDIA embeddings
│   │   ├── feedback.js         # anonymous verdict counters (memory only)
│   │   ├── handbookExtract.js  # PDF extraction and section-aware chunking
│   │   ├── handbookSearch.js   # index loading, hybrid retrieval, ranking, TOC
│   │   ├── promptBuilder.js    # grounded system/user prompts, history, vision
│   │   └── safetyFilter.js     # scope, safety, injection, false-claim rules
│   └── errors.js
├── worker/
│   └── index.js                # Cloudflare Workers entry (Express via httpServerHandler)
├── scripts/
│   ├── check-config.js         # npm run check
│   ├── eval-retrieval.js       # npm run eval (golden-set scoreboard)
│   ├── index-handbook.js       # npm run index
│   ├── upload-index-kv.js      # npm run kv:upload (index -> HANDBOOK_INDEX KV)
│   ├── debug-safety.js
│   ├── debug-search.js
│   └── smoke-live.js           # end-to-end checks against a running server
├── tests/                      # 87 tests incl. retrieval eval + headless browser
├── deploy/sti-assist.service   # systemd unit sample
├── Dockerfile                  # container image (index must be built first)
├── wrangler.jsonc              # Workers config: static assets, KV binding, /api/* worker-first
├── .github/workflows/ci.yml    # Node 20/22/24 matrix
├── data/
│   ├── index.json              # generated retrieval index (gitignored)
│   ├── handbook.json           # generated readable chunks (gitignored)
│   └── models/                 # local embedding cache (gitignored)
├── .env.example
├── .gitignore
├── package.json
└── README.md
```

---

## Verification status

Verified locally in this workspace:

- PDF extraction, section-aware chunking, and index generation (171 chunks, 131 sections, pp. 9–61).
- Hybrid retrieval ranking for ID, Taglish ID, uniform/slippers, tardiness, phones, lost items, discipline, weapons, and cheating.
- Safety classifications and refusals for weapons, concealment, threats, violence, self-harm, cheating, rule evasion, prompt injection, and out-of-scope tasks.
- Demo-mode API responses with real sources and explicit “not AI” labeling.
- Citation verification and source card rendering.
- Image upload validation, memory storage, TTL metadata, owner-bound deletion, and demo-mode “not analyzed” messaging.
- Responsive desktop and mobile layouts in headless Edge (including true 390 px device emulation).
- About/privacy modal, source expansion, copy/retry controls, and status badges.
- SSE streaming end to end against a mock OpenAI-compatible provider: `sources` arrives before the first `delta`, the final `done` event carries the verified answer, and client disconnects abort the provider request. Live-provider streaming uses the same path.
- Citation deep links: printed page 39 maps to `/handbook.pdf#page=40`; the PDF route serves the indexed document with `noindex` and private caching.
- **98 automated tests passing**, including the golden-set retrieval evaluation (hit@3 and page-accuracy thresholds), six headless-browser checks of the client (streamed answer, citations, theme persistence, quick actions), and eleven Worker-mode tests (KV index loading and isolate caching, Taglish retrieval, capabilities/meta, SSE, safety filter, missing-KV behavior, and wrangler.jsonc wiring).
- **Worker deployment verified locally with `wrangler dev` on 2026-11-01**: static assets with `_headers` security headers, `/api/health` and `/api/meta` in AI mode, a real NVIDIA answer citing the ID Card p. 39, Taglish retrieval and answer, SSE streaming (sources first at ~0.2 s, 87 delta events, one `done`, zero errors) for the gadget rule p. 43, image uploads returning the explicit 501 message, and `/handbook.pdf` returning 404. Not yet verified: an actual `wrangler deploy` to a live account.
- `npm run check` reporting a valid configuration.
- **Live vision verified on 2026-10-31**: upload → analysis → grounded answer with `nvidia/nemotron-3.5-super-vl-120b-a12b` (`analyzed: true`, accurate description, supplementary-context framing kept).
- **Live “handbook only” verified**: `preferExcerpts: true` returns `mode: "excerpts"` with the honest label and **no model call** (`usage` absent).
- **Live streaming verified**: 118 `delta` events, first token after ~0.5 s, one `done`, zero `error` events against the real provider.
- Transient provider behavior handled: 404s for a deployed model and reasoning-token truncation are retried once (both observed live and now covered by tests).
- `npm run smoke`: all 21 end-to-end scenarios passing against the live server — **in demo mode and in live AI mode** (`nvidia/nemotron-3.5-bolt-e4b`) — correct sections and printed pages for ID (p. 39), uniform (p. 40), tardiness (p. 37), gadgets (p. 43), lost items, discipline, and violence against a person; correct refusal categories for concealment, violence, threats, self-harm, prompt injection, and out-of-scope questions; no fabricated page citations; a non-image file rejected on content sniffing.
- **Live AI answer quality**, checked by reading real replies: *“Can I bring a gun inside the campus?”* answers from Major Offenses – Category D (p. 57) and the weapons section (p. 47) with correct citations plus a calm safety note, and does not refuse a legitimate policy question. *“How do I apply for a dormitory room at STI?”* returns the required “I couldn't find a clear answer … confirm with the appropriate school office” fallback instead of inventing a policy.
- Model selection verified against the live provider: the previous default (`meta/llama-3.3-70b-instruct`) is **retired (HTTP 410)**, and reasoning models such as `nvidia/nemotron-3.5-lightning-30b-a3b` starve the visible answer with hidden reasoning tokens. The default is now `nvidia/nemotron-3.5-bolt-e4b`.
- Independent audit of the security-sensitive paths: markdown rendering escapes before formatting and only links `https?://` URLs; image uploads are typed by file content, not extension; `.env` and the handbook PDF are gitignored; no key material is reachable from the browser.

**Not verified:**

- **Vision availability beyond this account.** Live image understanding now works (see above), but which vision model is deployed is account-scoped; a different key may need a different `AI_VISION_MODEL`.
- Limits and behavior of a specific school's deployment, campus-specific policies, or later STI announcements.
- Screen-reader behavior across every browser/OS combination (basic semantic HTML, labels, focus trap, and reduced-motion support are implemented; no real screen-reader pass has been run).
- The service worker’s offline fallback on a real deployed origin (it is exercised only implicitly; API and PDF requests are never cached by design).

**Fixed in this pass** (all covered by tests): a retired default model that broke the first AI request; an unmapped HTTP 410 that produced a vague error; answers truncated at the token limit being shown as if complete; a source-card cap that let the model cite a page the student could not open; a prompt-injection pattern that refused ordinary questions like *“What does this notice say, and what does the handbook say about IDs?”*; a vocabulary gap that made violence questions cite uniform and classroom sections; short standalone questions being merged with an unrelated earlier topic; and — from an audit of 71 student phrasings across every handbook topic — missing word forms in both the search vocabulary and the scope filter (`stole`, `broke`, `vandalised`, `expelled`, `punched`, `threatened`, `blackmailed`, `harassed`, `skipped`) that made legitimate concerns retrieve unrelated sections or be refused outright, plus a personal-data rule that treated any mention of "my grades" as a record lookup.

STI Assist AI is an educational prototype. Do not present it as an official STI service, and do not rely on it as the final authority on school policy.
