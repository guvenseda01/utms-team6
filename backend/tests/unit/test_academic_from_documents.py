"""Unit tests for academic record built from document extraction."""
from datetime import datetime, timezone
from unittest.mock import MagicMock

from app.domain.enums import DocType
from app.services.academic_from_documents import academic_record_from_documents


def _doc(doc_type: DocType, extracted_data: dict | None, uploaded_at: datetime) -> MagicMock:
    d = MagicMock()
    d.doc_type = doc_type
    d.extracted_data = extracted_data
    d.uploaded_at = uploaded_at
    return d


def test_academic_record_from_transcript_and_yks():
    t0 = datetime(2026, 1, 1, tzinfo=timezone.utc)
    t1 = datetime(2026, 1, 2, tzinfo=timezone.utc)
    docs = [
        _doc(
            DocType.TRANSCRIPT,
            {"gpa": 3.55, "institution": "EXAMPLE UNIVERSITY", "completed_credits": 34},
            t0,
        ),
        _doc(
            DocType.YKS_RESULT,
            {"placement_score": 392.144, "score": 392.144, "score_type": "SAY"},
            t1,
        ),
    ]
    record = academic_record_from_documents(docs)
    assert record is not None
    assert record["gpa_4"] == 3.55
    assert record["yks_score"] == 392.144
    assert record["source"] == "TRANSCRIPT+YKS (parsed from documents)"


def test_academic_record_empty_when_no_parsed_docs():
    assert academic_record_from_documents([]) is None
