"""
build_corpus.py — turn a folder of plain-text/Markdown source files into
corpus.json for the client-side BM25 retrieval engine (see retrieval/bm25.js).

Usage:
    python3 build_corpus.py [--sources DIR] [--out FILE] [--labels FILE]

    --sources   directory of .txt/.md files to index (default: ./sources)
    --out       output path for the generated corpus (default: ./corpus.json)
    --labels    optional JSON file mapping filename -> a human-readable
                source label shown as a citation (default: sources/labels.json
                if it exists). Any file not listed there falls back to its
                filename, prettified (underscores/hyphens -> spaces, title case).

Chunking: paragraph-aware — accumulates paragraphs up to ~160 words and
flushes at a paragraph boundary, so a chunk never cuts mid-thought unless a
single paragraph alone exceeds 240 words (then it's hard-split). Chunks
under 8 words are dropped as too thin to be useful on their own.
"""
import argparse
import json
import re
from pathlib import Path


def clean(text: str) -> str:
    text = text.replace("\xa0", " ")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def chunk_text(text: str, target_words: int = 160, max_words: int = 240):
    paras = [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]
    chunks, buf, buf_words = [], [], 0

    def flush():
        if buf:
            chunks.append("\n\n".join(buf).strip())

    for para in paras:
        words = para.split()
        if len(words) > max_words:
            flush()
            buf, buf_words = [], 0
            for i in range(0, len(words), max_words):
                chunks.append(" ".join(words[i:i + max_words]))
            continue
        if buf_words + len(words) > target_words and buf:
            flush()
            buf, buf_words = [], 0
        buf.append(para)
        buf_words += len(words)
    flush()
    return [c for c in chunks if len(c.split()) >= 8]


def prettify_label(stem: str) -> str:
    return stem.replace("_", " ").replace("-", " ").strip().title()


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--sources", default="sources")
    parser.add_argument("--out", default="corpus.json")
    parser.add_argument("--labels", default=None)
    args = parser.parse_args()

    src_dir = Path(args.sources)
    out_path = Path(args.out)
    labels_path = Path(args.labels) if args.labels else (src_dir / "labels.json")

    labels = {}
    if labels_path.exists():
        labels = json.loads(labels_path.read_text(encoding="utf-8"))

    corpus = []
    cid = 0
    files = sorted(p for p in src_dir.glob("*") if p.suffix.lower() in (".txt", ".md") and p.name != "labels.json")
    if not files:
        raise SystemExit(f"No .txt/.md files found in {src_dir}/ — add your source documents there first.")

    for fp in files:
        raw = fp.read_text(encoding="utf-8", errors="ignore")
        text = clean(raw)
        label = labels.get(fp.name, prettify_label(fp.stem))
        for chunk in chunk_text(text):
            cid += 1
            corpus.append({"id": cid, "source": label, "text": chunk})

    out_path.write_text(json.dumps(corpus, ensure_ascii=False, indent=None))
    total_words = sum(len(c["text"].split()) for c in corpus)
    print(f"{len(corpus)} chunks from {len(files)} files -> {out_path}")
    print(f"total words indexed: {total_words}")


if __name__ == "__main__":
    main()
