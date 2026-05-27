# OCR Benchmark 2026-05-21

## Goal

Compare the current blurry-label OCR rescue default, `microsoft/trocr-large-printed`, with the newer Hugging Face TrOCR-style printed checkpoint `AbteeXAILab/lumynax-ocr-trocr-large-printed`, which was last modified on May 21, 2026.

The default should only change if the newer checkpoint produces better evidence on the blurry-label rescue fixture.

## Candidate

| Model | Updated | Notes |
| --- | --- | --- |
| `microsoft/trocr-large-printed` | May 27, 2024 | Current default, 608M parameter `vision-encoder-decoder` model. |
| `AbteeXAILab/lumynax-ocr-trocr-large-printed` | May 21, 2026 | Candidate, 608M parameter `vision-encoder-decoder` model, printed OCR tags. |

## Fixture

The committed blurry-label rescue test uses `public/test-fixtures/blurry-label-ocr-test.png`, a small downsampled PNG label fixture for:

```text
DENSO 104210-1230
```

The fixture text above is rendered into a printed label image, downsampled, and blurred to match the `too_blurry` OCR rescue scenario. The server-side identify test verifies that the OCR request sends that exact fixture image before Gemini receives the extracted label text.

## Environment

```text
Python 3.12
torch 2.11.0+cpu
transformers 4.46.3
Pillow 11.3.0
Device: CPU
```

## Results

| Model | OCR output | Normalized output | Character accuracy | Decision input |
| --- | --- | --- | --- | --- |
| `microsoft/trocr-large-printed` | `DENSO 104210-1230` | `DENSO1042101230` | `1.0000` | Baseline extracted the expected text exactly. |
| `AbteeXAILab/lumynax-ocr-trocr-large-printed` | `DENSO 104210-1230` | `DENSO1042101230` | `1.0000` | Candidate tied baseline but did not beat it. |

## Decision

Do not switch the default OCR model.

The newer checkpoint tied the current default on the blurry-label rescue fixture text, so there is no evidence-based improvement. `/api/identify` remains unchanged, and extracted OCR text continues to be saved through the existing result evidence entry:

```text
OCR label text: <extracted text>
```
