# Generation layer (Cloudflare Worker)

Retrieval happens entirely in the browser (`retrieval/bm25.js` over `corpus.json`). This Worker is the one piece that has to run server-side: it takes the question and the retrieved passages, and asks Groq to turn them into a fluent answer — because the Groq API key can never be shipped to client-side JS.

Cost: Cloudflare Workers free plan (100,000 requests/day) + Groq's free tier. $0 for typical personal-site traffic.

## Before you deploy

Edit the three constants at the top of `rag-worker.js`:

```js
const SITE_OWNER_NAME = 'Jane Doe';
const SITE_CONTEXT = "Jane Doe's personal portfolio website";
const ALLOWED_ORIGINS = ['https://example.com'];
```

## Option A — Cloudflare dashboard only (no install required)

1. Sign up / log in at [dash.cloudflare.com](https://dash.cloudflare.com) (free).
2. **Workers & Pages → Create → Create Worker.** Give it any name, click **Deploy** to scaffold it.
3. Click **Edit code**, replace the entire contents with your edited `rag-worker.js`, click **Deploy**.
4. **Settings → Variables and Secrets → Add.** Name: `GROQ_API_KEY`, type **Secret**, value: your [Groq API key](https://console.groq.com/keys). Save.
5. Copy the Worker's URL (`https://<name>.<your-subdomain>.workers.dev`) and put it in your site's `RAG_WORKER_URL`.

## Option B — Wrangler CLI

```bash
npm install -g wrangler
cd worker
wrangler login
wrangler deploy
wrangler secret put GROQ_API_KEY   # paste the key when prompted
```

## Notes

- The Worker only accepts requests from the origins listed in `ALLOWED_ORIGINS` — update it whenever your site's domain changes.
- If the Worker is ever unreachable or misconfigured, a well-built client should fall back to showing the retrieved passage directly (see the main README's "generation is optional" note) — the assistant should never fully break just because the generation layer is down.
- Nothing here requires a paid Cloudflare or Groq plan.
