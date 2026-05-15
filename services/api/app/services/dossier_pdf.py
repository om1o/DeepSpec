from __future__ import annotations

import io
from datetime import datetime, timezone

from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from app.schemas.types import VerificationResult


def render_verification_dossier_pdf(result: VerificationResult, *, title: str = "DeepSpec Technical Dossier") -> bytes:
    """Generate an audit-friendly PDF snapshot for client attachments."""

    styles = getSampleStyleSheet()
    meta = ParagraphStyle(name="Meta", parent=styles["Normal"], fontSize=9, leading=11)
    cite_style = ParagraphStyle(name="Cite", parent=styles["Normal"], fontSize=8, leading=10)

    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=letter, title=title, leftMargin=0.75 * inch, rightMargin=0.75 * inch)

    story: list = []
    story.append(Paragraph(title, styles["Title"]))
    story.append(
        Paragraph(
            f"Generated (UTC): {datetime.now(timezone.utc).isoformat()}",
            meta,
        )
    )
    story.append(Spacer(1, 0.15 * inch))

    v = result.verification
    story.append(Paragraph("Verification summary", styles["Heading2"]))
    story.append(
        Paragraph(
            f"Matched MPN: <b>{v.matched_mpn or 'UNKNOWN'}</b><br/>"
            f"Composite score: <b>{v.composite_score:.4f}</b><br/>"
            f"Source verified (composite heuristic): <b>{str(v.source_verified)}</b>",
            styles["Normal"],
        )
    )
    story.append(Spacer(1, 0.12 * inch))

    story.append(Paragraph("Signals", styles["Heading3"]))
    sig_rows = [
        ["Signal", "Value"],
        ["ocr_consensus", f"{v.signals.ocr_consensus:.4f}"],
        ["catalog_agreement", f"{v.signals.catalog_agreement:.4f}"],
        ["retrieval_overlap", f"{v.signals.retrieval_overlap:.4f}"],
        ["duplicate_evidence_agreement", f"{v.signals.duplicate_evidence_agreement:.4f}"],
    ]
    t = Table(sig_rows, hAlign="LEFT")
    t.setStyle(TableStyle([("GRID", (0, 0), (-1, -1), 0.25, None), ("BACKGROUND", (0, 0), (-1, 0), colors.whitesmoke)]))
    story.append(t)
    story.append(Spacer(1, 0.15 * inch))

    story.append(Paragraph("Physical specs", styles["Heading2"]))
    story.append(
        Paragraph(
            "<br/>".join([f"• {m}" for m in result.physical_specs.material_composition]),
            styles["Normal"],
        )
    )
    story.append(Paragraph(f"<b>Dimensions / weight:</b> {result.physical_specs.dimensions_weight}", styles["Normal"]))
    story.append(Spacer(1, 0.12 * inch))

    story.append(Paragraph("Technical data", styles["Heading2"]))
    story.append(Paragraph(f"<b>Purpose:</b> {result.technical_data.functional_purpose}", styles["Normal"]))
    story.append(Paragraph(f"<b>Wiring / pin evidence:</b> {result.technical_data.wiring_pinout}", styles["Normal"]))
    story.append(
        Paragraph("<br/>".join([f"• {c}" for c in result.technical_data.compatibility_set]), styles["Normal"]),
    )
    story.append(Spacer(1, 0.12 * inch))

    story.append(Paragraph("Risk gate", styles["Heading2"]))
    story.append(
        Paragraph(
            f"Human review required: <b>{str(result.risk_gate.human_review_required)}</b><br/>"
            + "<br/>".join([f"• {r}" for r in result.risk_gate.reasons]),
            styles["Normal"],
        )
    )

    story.append(Spacer(1, 0.15 * inch))
    story.append(Paragraph("Citations", styles["Heading2"]))

    for idx, c in enumerate(result.citations[:40], start=1):
        excerpt = (c.excerpt or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
        url = (c.url_archived or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
        story.append(
            Paragraph(
                f"<b>[{idx}]</b> doc={c.document_id} page={c.page}<br/>hash={c.excerpt_hash}<br/>"
                f"{excerpt}<br/><i>{url}</i>",
                cite_style,
            )
        )
        story.append(Spacer(1, 0.06 * inch))

    doc.build(story)
    pdf_bytes = buf.getvalue()
    buf.close()
    return pdf_bytes
