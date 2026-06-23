"""Unit tests for PDF field extraction (YKS glued table rows)."""
from app.external.document_extractor import _extract_yks, _extract_yks_say_placement


SAMPLE_YKS_TEXT = """
Exam Scores and Rankings
Score Type Raw Score Placement Score National Rank Status
TYT 315.420338.762245,318 Calculated
SAY 372.880392.14484,512 Calculated
Exam Year 2026 Document Type Sample Result
"""


def test_yks_say_placement_from_glued_table_row():
    score = _extract_yks_say_placement(SAMPLE_YKS_TEXT)
    assert score == 392.144


def test_yks_extract_includes_placement_score_and_exam_year():
    data = _extract_yks(SAMPLE_YKS_TEXT)
    assert data.get("placement_score") == 392.144
    assert data.get("score") == 392.144
    assert data.get("score_type") == "SAY"
    assert data.get("exam_year") == 2026
