from pydantic import BaseModel, Field


class Citation(BaseModel):
    source_type: str
    document_id: str
    page: int
    excerpt: str
    excerpt_hash: str
    char_start: int | None = None
    char_end: int | None = None
    url_archived: str | None = None


class VerificationSignals(BaseModel):
    ocr_consensus: float = Field(ge=0, le=1)
    catalog_agreement: float = Field(ge=0, le=1)
    retrieval_overlap: float = Field(ge=0, le=1)
    duplicate_evidence_agreement: float = Field(ge=0, le=1)


class VerificationBlock(BaseModel):
    composite_score: float = Field(ge=0, le=1)
    source_verified: bool
    matched_mpn: str | None
    signals: VerificationSignals


class PhysicalSpecs(BaseModel):
    material_composition: list[str]
    dimensions_weight: str


class TechnicalData(BaseModel):
    functional_purpose: str
    wiring_pinout: str
    compatibility_set: list[str]


class RiskGate(BaseModel):
    human_review_required: bool
    reasons: list[str]


class IncompleteData(BaseModel):
    message: str
    camera_guidance: str


class VerificationResult(BaseModel):
    verification: VerificationBlock
    physical_specs: PhysicalSpecs
    technical_data: TechnicalData
    action_required: str
    citations: list[Citation]
    risk_gate: RiskGate
    incomplete_data: IncompleteData | None = None


class OCRFusionSummary(BaseModel):
    incomplete_data: IncompleteData | None
    normalized_candidates: list[str]
    barcode_candidate: str | None
    ocr_candidates: list[str]
    conflicts: list[str]
    blur_score: float | None
