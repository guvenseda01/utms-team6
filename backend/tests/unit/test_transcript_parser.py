"""Unit tests for transcript_parser stacked-line and normalization."""

from __future__ import annotations

from unittest.mock import patch

from app.services.transcript_parser import TranscriptParser, parse_transcript

STACKED_TEXT = """
Completed Courses
Code
Course Title
Credits
Type
Grade
MATH101
Calculus I
4
Compulsory
AA
MATH102
Calculus II
4
Compulsory
BA
"""


def test_parse_stacked_lines_extracts_name_credit_grade():
    parser = TranscriptParser()
    courses = parser._parse_stacked_lines(STACKED_TEXT)
    assert len(courses) == 2
    assert courses[0].course_code == "MATH101"
    assert courses[0].course_name == "Calculus I"
    assert courses[0].credits == 4.0
    assert courses[0].grade == "AA"


def test_pypdf_fallback_uses_stacked_lines():
    parser = TranscriptParser()
    with patch.object(TranscriptParser, "_extract_with_pdfplumber", side_effect=RuntimeError("unavailable")):
        with patch.object(
            TranscriptParser,
            "_extract_with_pypdf",
            return_value=STACKED_TEXT,
        ):
            result = parser.parse(b"%PDF-fake")
    assert result.parser_strategy == "stacked_lines"
    assert len(result.courses) == 2
    assert result.courses[1].course_code == "MATH102"
