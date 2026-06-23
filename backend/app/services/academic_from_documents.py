"""Build academic fields from uploaded document extraction (no external mock APIs)."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional

from app.domain.document import Document
from app.domain.enums import DocType


def _num(value: Any) -> Optional[float]:
    if value is None or value == "":
        return None
    try:
        n = float(value)
    except (TypeError, ValueError):
        return None
    return n if n == n else None  # NaN guard


def _latest_doc(documents: list[Document], doc_type: DocType) -> Optional[Document]:
    matches = [d for d in documents if d.doc_type == doc_type]
    if not matches:
        return None
    return max(matches, key=lambda d: d.uploaded_at)


def _latest_parsed(documents: list[Document], doc_type: DocType) -> Optional[Document]:
    for doc in sorted(documents, key=lambda d: d.uploaded_at, reverse=True):
        if doc.doc_type != doc_type or not doc.extracted_data:
            continue
        if not isinstance(doc.extracted_data, dict):
            continue
        if any(k != "_missing" for k in doc.extracted_data):
            return doc
    return None


def yks_score_from_documents(documents: list[Document]) -> Optional[float]:
    yks = _latest_parsed(documents, DocType.YKS_RESULT) or _latest_doc(
        documents, DocType.YKS_RESULT
    )
    if not yks or not isinstance(yks.extracted_data, dict):
        return None
    data = yks.extracted_data
    if not data or all(k == "_missing" for k in data):
        return None
    return _num(
        data.get("placement_score")
        or data.get("score")
        or data.get("yks_score")
        or data.get("puan")
    )


def academic_record_from_documents(
    documents: list[Document],
) -> Optional[dict[str, Any]]:
    transcript = _latest_parsed(documents, DocType.TRANSCRIPT)
    yks_score = yks_score_from_documents(documents)

    if transcript is None and yks_score is None:
        return None

    t = transcript.extracted_data if transcript and isinstance(transcript.extracted_data, dict) else {}
    sources: list[str] = []

    record: dict[str, Any] = {
        "institution": None,
        "gpa_4": None,
        "gpa_100": None,
        "yks_score": None,
        "credits_completed": None,
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "source": None,
        "errors": None,
    }

    gpa = _num(t.get("gpa") or t.get("gpa_4"))
    if gpa is not None:
        record["gpa_4"] = gpa
        sources.append("TRANSCRIPT")
    if t.get("institution"):
        record["institution"] = str(t["institution"])
        if "TRANSCRIPT" not in sources:
            sources.append("TRANSCRIPT")
    credits = _num(t.get("completed_credits") or t.get("credits_completed"))
    if credits is not None:
        record["credits_completed"] = int(credits)

    if yks_score is not None:
        record["yks_score"] = yks_score
        sources.append("YKS")

    if not sources:
        return None

    record["source"] = f"{'+'.join(sources)} (parsed from documents)"
    return record
