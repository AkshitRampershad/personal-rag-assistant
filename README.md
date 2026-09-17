# Personal RAG Assistant

A real retrieval-augmented generation chatbot for a personal site or portfolio — not a scripted FAQ bot. It answers questions grounded in an actual knowledge corpus you build from your own resume, docs, and project write-ups, with zero servers required for retrieval and a free-tier generation layer for fluent answers.

**Live example:** [akshitrampershad.github.io/portfolio](https://akshitrampershad.github.io/portfolio/) — the chat widget bottom-right runs exactly this system, built from a corpus of resume, transcript, certifications, and project READMEs.

**Try the demo in this repo:** open `example/widget.html` in a browser (or serve the repo locally) to see the whole thing running against a tiny 2-document sample corpus about a fictional person.

---

## How it works — two stages

```
 Your docs (resume.txt, project.md, ...)
        │
        ▼  corpus/build_corpus.py
   corpus.json  (chunked, labeled passages)
        │
        ▼  fetched once by the browser
┌─────────────────────────────────────────┐
│ Stage 1 — Retrieval (client-side)        │
│ retrieval/bm25.js: BM25 keyword search   │
│ over corpus.json. No server, no API key. │
└─────────────────────────────────────────┘
        │  top-scoring passages
        ▼
┌─────────────────────────────────────────┐
│ Stage 2 — Generation (optional)          │
│ worker/rag-worker.js: a Cloudflare       │
│ Worker asks Groq to write one fluent     │
│ answer, grounded ONLY in what Stage 1    │
│ retrieved.                               │
└─────────────────────────────────────────┘
        │
        ▼
   answer shown in the chat widget
```

**Stage 1 always works on its own.** It's pure client-side JS — retrieval runs in the visitor's browser against a static JSON file. Ship just Stage 1 and you have a working assistant that shows the raw retrieved passage as the answer, with zero moving parts and zero cost.

**Stage 2 is additive, not required.** It turns the retrieved passage into a fluent, first-person-sounding answer instead of a raw text block — but it's explicitly instructed to answer *only* from what Stage 1 retrieved, never from outside knowledge, so it can't invent facts about you. If the Worker is ever down, slow, or not configured, a well-built client falls back to the Stage 1 passage automatically (see `example/widget.html`'s `generateAnswer` for the pattern) — the assistant should never fully break because the generation layer is unavailable.

Why BM25 instead of embeddings? No model download (client stays light), no vector database, and for a personal-site corpus that's dense with proper nouns and technical terms (project names, employer names, tool names), keyword retrieval genuinely competes with dense retrieval while being trivial to run entirely in the browser.

---

## Quickstart

1. **Write your source documents.** Plain text or Markdown, one topic per file — a resume, a transcript, project READMEs, whatever you want the assistant to know. Put them in a `sources/` folder.
2. **Build the corpus:**
   ```bash
   python3 corpus/build_corpus.py --sources sources --out corpus.json
   ```
   Optionally add a `sources/labels.json` mapping filenames to nicer citation labels (see `example/sources/labels.json`).
3. **Wire up the widget.** Copy the HTML/CSS/JS pattern from `example/widget.html` into your site, pointing `fetch('corpus.json')` at your generated file. `retrieval/bm25.js` is a plain `<script>` include — no build step.
4. **(Optional) Add generation.** Follow `worker/README.md` to deploy the Cloudflare Worker, then set `RAG_WORKER_URL` in your widget JS to the deployed Worker's URL.
5. **Tune the relevance threshold.** `RAG_MIN_SCORE` (the minimum BM25 score before an answer counts as "found") needs recalibrating for your corpus size — a bigger, more varied corpus produces higher scores for a genuine match. Ask a few real questions, log the scores, and set the threshold so wrong-topic questions reliably fall through to your fallback message instead of returning a barely-related passage.

## Tuning retrieval

- **Add stopwords** for any word that's common across nearly your whole corpus but carries no distinguishing signal (your own name is a common one — it appears in every chunk about you, so it just adds noise to scoring). See `STOPWORDS` in `retrieval/bm25.js`.
- **Same-source second passages:** `formatRagAnswer` in `example/widget.html` allows a second passage in the answer only if it scores close to the top one — this avoids stapling an unrelated passage onto a good match, while still letting two genuinely relevant chunks from the same large source file both surface for a broad question.
- **Minimum term matches:** a query longer than 2 words requires at least 2 of its terms to appear in a chunk before that chunk counts as a candidate, so one coincidental common-word overlap can't surface a wrong-topic passage. Short queries (1-2 words, usually a single proper noun) only need 1 match.

## Repository layout

```
retrieval/bm25.js       BM25 retrieval engine — vanilla JS, no dependencies
corpus/build_corpus.py  turns a folder of .txt/.md files into corpus.json
worker/rag-worker.js    Cloudflare Worker: retrieved passages -> Groq -> fluent answer
worker/wrangler.toml    Worker config
worker/README.md        deploy instructions (dashboard-only or CLI)
example/widget.html     standalone demo: full chat widget, wired to example/corpus.json
example/sources/        the two sample source files behind the demo
```

## Cost

$0 for normal personal-site traffic — Cloudflare Workers' free tier (100,000 requests/day) and Groq's free tier both comfortably cover it. Retrieval itself has no cost at all since it never leaves the browser.

## License

MIT — see `LICENSE`.
