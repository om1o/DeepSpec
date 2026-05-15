from __future__ import annotations

from dataclasses import dataclass

import fitz  # pymupdf


@dataclass(frozen=True)
class PdfChunk:
    page: int
    chunk_index: int
    text: str


def chunk_pdf_bytes(data: bytes, *, max_chars: int = 900, overlap: int = 120) -> list[PdfChunk]:
    doc = fitz.open(stream=data, filetype="pdf")
    chunks: list[PdfChunk] = []
    try:
        chunk_index = 0
        for page_no in range(doc.page_count):
            page = doc.load_page(page_no)
            text = page.get_text("text") or ""
            text = text.replace("\r", "\n")
            text = "\n".join([ln.strip() for ln in text.split("\n")]).strip()
            if not text:
                continue

            start = 0
            while start < len(text):
                end = min(len(text), start + max_chars)
                piece = text[start:end].strip()
                if piece:
                    chunks.append(PdfChunk(page=page_no + 1, chunk_index=chunk_index, text=piece))
                    chunk_index += 1
                if end >= len(text):
                    break
                start = max(0, end - overlap)
    finally:
        doc.close()

    return chunks
