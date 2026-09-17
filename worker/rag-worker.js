// Cloudflare Worker: the generation layer for a personal RAG assistant.
//
// The site's own JS does retrieval client-side (BM25 over corpus.json, see
// retrieval/bm25.js) and POSTs the question plus the retrieved passages
// here. This Worker's only job is to turn those passages into one fluent,
// grounded answer via Groq — the one piece that has to live server-side,
// since an LLM API key can never be shipped to the browser.
//
// ---- EDIT THESE THREE THINGS FOR YOUR OWN DEPLOYMENT ----
const SITE_OWNER_NAME = 'Jane Doe'; // whoever the assistant answers questions about
const SITE_CONTEXT = "Jane Doe's personal portfolio website"; // one line of context for the system prompt
const ALLOWED_ORIGINS = [
  'https://example.com', // the origin(s) your site is actually served from
];
// -----------------------------------------------------------

const GROQ_MODEL = 'openai/gpt-oss-120b';
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

const MAX_QUERY_LEN = 300;
const MAX_PASSAGES = 5;
const MAX_PASSAGE_LEN = 800;

// Required Worker secret (set via `wrangler secret put GROQ_API_KEY` or the
// Cloudflare dashboard — never in this file or in wrangler.toml):
//   GROQ_API_KEY

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.includes(origin);
  if (!allowed) return null;
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  };
}

function json(body, status, extraHeaders) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: Object.assign({ 'Content-Type': 'application/json' }, extraHeaders || {}),
  });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const cors = corsHeaders(origin);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: cors ? 204 : 403, headers: cors || {} });
    }

    if (!cors) {
      return json({ error: 'origin not allowed' }, 403);
    }

    if (request.method !== 'POST') {
      return json({ error: 'method not allowed' }, 405, cors);
    }

    let payload;
    try {
      payload = await request.json();
    } catch (e) {
      return json({ error: 'invalid json body' }, 400, cors);
    }

    const query = typeof payload.query === 'string' ? payload.query.trim().slice(0, MAX_QUERY_LEN) : '';
    const passages = Array.isArray(payload.passages) ? payload.passages.slice(0, MAX_PASSAGES) : [];

    if (!query || !passages.length) {
      return json({ error: 'query and passages are required' }, 400, cors);
    }

    const context = passages
      .map(function (p, i) {
        var source = typeof p.source === 'string' ? p.source.slice(0, 120) : 'Unknown source';
        var text = typeof p.text === 'string' ? p.text.slice(0, MAX_PASSAGE_LEN) : '';
        return '[' + (i + 1) + '] (' + source + ') ' + text;
      })
      .join('\n\n');

    const systemPrompt =
      'You are a helpful assistant embedded on ' + SITE_CONTEXT + ', answering ' +
      "a visitor's question about " + SITE_OWNER_NAME + '. Answer using ONLY the context passages provided below — never use ' +
      'outside knowledge and never invent facts not present in them. Write 2-5 sentences of clear, friendly, ' +
      'third-person prose (e.g. "' + SITE_OWNER_NAME + ' built..."), no markdown headers or bullet lists. If the ' +
      "passages don't contain enough information to answer, say so honestly rather than guessing, and suggest " +
      'the visitor browse the relevant section of the site or ask a more specific question.';

    const userPrompt = 'Question: ' + query + '\n\nContext passages:\n' + context + '\n\nAnswer the question using only the context above.';

    let groqRes;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(function () { controller.abort(); }, 15000);
      groqRes = await fetch(GROQ_URL, {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + env.GROQ_API_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: GROQ_MODEL,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          temperature: 0.3,
          max_tokens: 350,
        }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
    } catch (e) {
      return json({ error: 'generation upstream unreachable' }, 502, cors);
    }

    if (!groqRes.ok) {
      return json({ error: 'generation upstream error', status: groqRes.status }, 502, cors);
    }

    let data;
    try {
      data = await groqRes.json();
    } catch (e) {
      return json({ error: 'invalid upstream response' }, 502, cors);
    }

    const answer = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (!answer) {
      return json({ error: 'empty generation' }, 502, cors);
    }

    return json({ answer: answer.trim() }, 200, cors);
  },
};
