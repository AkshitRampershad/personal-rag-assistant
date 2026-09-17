/**
 * bm25.js — a small, dependency-free BM25 retrieval engine for a static
 * "personal RAG assistant" chatbot. Runs entirely client-side: no server,
 * no API key, no model download. Point it at a corpus.json (see
 * corpus/build_corpus.py) built from your own resume, docs, project
 * READMEs, whatever you want the assistant to know about.
 *
 * Usage:
 *   <script src="retrieval/bm25.js"></script>
 *   <script>
 *     fetch('corpus.json')
 *       .then(function (res) { return res.json(); })
 *       .then(function (corpus) {
 *         var index = RagRetrieval.buildIndex(corpus);
 *         var results = RagRetrieval.retrieve(index, "what did you build?", 3);
 *         // results: [{ score, doc: { id, source, text } }, ...]
 *       });
 *   </script>
 *
 * corpus.json shape: an array of { id, source, text } objects, where
 * `source` is a human-readable label (shown as a citation) and `text` is
 * the chunk's content. build_corpus.py produces this from a folder of
 * plain-text/Markdown source files.
 */
(function (global) {
  'use strict';

  var BM25_K1 = 1.5;
  var BM25_B = 0.75;

  // Generic English stopwords, tuned for keyword retrieval over a small,
  // domain-specific corpus. Add your own if you notice a common word in
  // your source material (e.g. your own name) is drowning out real terms —
  // see the README's "tuning retrieval" section.
  var STOPWORDS = {};
  ('i me my myself we our ours ourselves you your yours yourself yourselves he him his himself ' +
   'she her hers herself it its itself they them their theirs themselves what which who whom ' +
   'this that these those am is are was were be been being have has had having do does did doing ' +
   'a an the and but if or because as until while of at by for with about against between into ' +
   'through during before after above below to from up down in out on off over under again ' +
   'further then once here there when where why how all any both each few more most other some ' +
   'such no nor not only own same so than too very can will just should now also please would ' +
   'could get got tell know learn learned').split(' ').forEach(function (w) { STOPWORDS[w] = 1; });

  function stem(w) {
    // Light suffix-stripping so "workshops"/"workshop", "certifications"/
    // "certification" etc. hit the same term — this matters most for small
    // corpora where a single plural/verb-form mismatch can cost real recall.
    if (w.length > 6 && w.slice(-3) === 'ing') return w.slice(0, -3);
    if (w.length > 5 && w.slice(-2) === 'ed') return w.slice(0, -2);
    if (w.length > 5 && w.slice(-3) === 'ies') return w.slice(0, -3) + 'y';
    if (w.length > 4 && w.slice(-2) === 'es' && /[sxz]$/.test(w.slice(0, -2))) return w.slice(0, -2);
    if (w.length > 4 && w.slice(-1) === 's' && w.slice(-2) !== 'ss' && w.slice(-2) !== 'us') return w.slice(0, -1);
    return w;
  }

  function tokenize(str) {
    // Split on any non-alphanumeric (hyphens included) so a compound like
    // "sub-certifications" still matches a query for "certification".
    var matches = (str || '').toLowerCase().match(/[a-z0-9]+/g) || [];
    var out = [];
    for (var i = 0; i < matches.length; i++) {
      if (matches[i].length > 1 && !STOPWORDS[matches[i]]) out.push(stem(matches[i]));
    }
    return out;
  }

  function buildIndex(corpus) {
    var N = corpus.length;
    var docTokens = new Array(N);
    var df = {};
    var i, j;
    for (i = 0; i < N; i++) {
      var tokens = tokenize(corpus[i].text);
      docTokens[i] = tokens;
      var seen = {};
      for (j = 0; j < tokens.length; j++) {
        if (!seen[tokens[j]]) { seen[tokens[j]] = true; df[tokens[j]] = (df[tokens[j]] || 0) + 1; }
      }
    }
    var idf = {};
    for (var term in df) {
      idf[term] = Math.log(1 + (N - df[term] + 0.5) / (df[term] + 0.5));
    }
    var totalLen = 0;
    var docStats = new Array(N);
    for (i = 0; i < N; i++) {
      var tf = {};
      for (j = 0; j < docTokens[i].length; j++) {
        tf[docTokens[i][j]] = (tf[docTokens[i][j]] || 0) + 1;
      }
      docStats[i] = { tf: tf, len: docTokens[i].length };
      totalLen += docTokens[i].length;
    }
    return { corpus: corpus, docStats: docStats, idf: idf, avgdl: N ? totalLen / N : 0 };
  }

  function retrieve(index, query, topK) {
    if (!index || !index.corpus.length) return [];
    var rawTokens = tokenize(query);
    var qTokens = [];
    for (var i = 0; i < rawTokens.length; i++) {
      if (qTokens.indexOf(rawTokens[i]) === -1) qTokens.push(rawTokens[i]);
    }
    if (!qTokens.length) return [];
    // For longer queries, require at least 2 distinct query terms to
    // actually appear in a chunk so one coincidental common-word hit can't
    // surface an unrelated passage; a 1-2 word query is usually already a
    // single distinctive term (e.g. a proper noun), so 1 match is enough.
    var minMatches = qTokens.length <= 2 ? 1 : 2;
    var scored = [];
    for (var d = 0; d < index.corpus.length; d++) {
      var stats = index.docStats[d];
      var score = 0;
      var matches = 0;
      for (var t = 0; t < qTokens.length; t++) {
        var term = qTokens[t];
        var f = stats.tf[term];
        if (!f) continue;
        matches++;
        var idf = index.idf[term] || 0;
        var denom = f + BM25_K1 * (1 - BM25_B + BM25_B * (stats.len / index.avgdl));
        score += idf * (f * (BM25_K1 + 1)) / denom;
      }
      if (matches >= minMatches && score > 0) {
        scored.push({ score: score, doc: index.corpus[d] });
      }
    }
    scored.sort(function (a, b) { return b.score - a.score; });
    return scored.slice(0, topK || 3);
  }

  global.RagRetrieval = {
    buildIndex: buildIndex,
    retrieve: retrieve,
    tokenize: tokenize,
    stem: stem
  };
})(typeof window !== 'undefined' ? window : this);
