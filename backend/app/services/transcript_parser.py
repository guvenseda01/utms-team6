"""
Transcript PDF Parser
=====================
Extracts course information from student transcripts in various university formats.
Output is always returned in a consistent schema regardless of the input format.

Supported formats:
  - Table-based PDF (pdfplumber table extraction)
  - Line-based text (regex parsing)
  - Mixed / unrecognized formats (heuristic fallback)
"""

from __future__ import annotations

import io
import logging
import re
from dataclasses import dataclass, field
from typing import Optional

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Turkish character normalization helper
# ---------------------------------------------------------------------------

def _tr_lower(text: str) -> str:
    """Lowercase with correct handling of Turkish special characters."""
    return (
        text
        .replace("İ", "i").replace("I", "i")
        .replace("Ğ", "ğ").replace("Ş", "ş")
        .replace("Ü", "ü").replace("Ö", "ö")
        .replace("Ç", "ç").replace("Â", "a")
        .lower()
    )


def _contains(haystack: str, needle: str) -> bool:
    """Turkish-aware substring check."""
    return needle in _tr_lower(haystack)


def _contains_any(text: str, keywords: set) -> bool:
    t = _tr_lower(text)
    return any(kw in t for kw in keywords)


# ---------------------------------------------------------------------------
# Output schema
# ---------------------------------------------------------------------------

@dataclass
class ParsedCourse:
    """A single course record extracted from a transcript."""
    course_code: Optional[str]   # e.g. "MAT101", "CENG211" — None if not found
    course_name: str             # e.g. "Calculus I"
    credits: Optional[float]    # ECTS or local credit value
    grade: Optional[str]        # e.g. "AA", "BB", "4.00", "PASS"
    semester: Optional[str]     # e.g. "2022-2023 Fall" — None if not found


@dataclass
class TranscriptParseResult:
    """Final output of the parser."""
    courses: list[ParsedCourse] = field(default_factory=list)
    raw_text: str = ""                  # full extracted text, useful for debugging
    parser_strategy: str = "unknown"    # which strategy was used
    warnings: list[str] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

# Known grade aliases (Turkish) mapped to standard values
_GRADE_ALIASES: dict[str, str] = {
    "gecti": "P", "kaldi": "F", "muaf": "EX", "devamsiz": "F",
    "gecmis": "P", "passes": "P", "fail": "F", "exempt": "EX",
}

# Possible column header keywords for credits, grades, names and codes
_CREDIT_HEADERS = {"kredi", "credit", "akts", "ects", "t+u+l", "saat", "unit", "kredisi"}
_GRADE_HEADERS  = {"not", "grade", "harf notu", "letter", "puan", "sonuc", "sonuç",
                   "basari notu", "basari", "harf"}
_NAME_HEADERS   = {"ders adi", "ders adı", "dersin adi", "dersin adı",
                   "course name", "course title", "adi", "adı", "name", "title",
                   "ders", "course"}
_CODE_HEADERS   = {"ders kodu", "kod", "code", "course code", "kodu"}

# Course code pattern — at least 2 letters followed by 3-4 digits
_CODE_RE = re.compile(r"\b([A-ZÇĞİÖŞÜa-zçğışöüü]{2,6}[\s\-]?\d{3,4}[A-Z]?)\b")

# Credit value patterns: "3", "3.0", "3,0", "(3)", "3+0+0"
_CREDIT_RE = re.compile(r"^\(?(\d{1,2}(?:[.,]\d)?)\)?$")
_CREDIT_COMPOSITE_RE = re.compile(r"^(\d+)\+\d+\+\d+$")  # "3+0+0" -> credits=3

# Letter grade pattern
_GRADE_RE = re.compile(
    r"^(AA|BA|BB|CB|CC|DC|DD|FD|FF|F|P|W|I|S|U|EX|NA"
    r"|[A-D][+-]?|[0-4](?:[.,]\d{1,2})?|%?\d{2,3})$",
    re.IGNORECASE,
)

# Compact row: MATH101 Calculus I 4 BA  (also works when pypdf glues columns)
_COURSE_ROW_RE = re.compile(
    r"\b([A-ZÇĞİÖŞÜa-zçğışöü]{2,6}[\s\-]?\d{3,4}[A-Z]?)\s+"
    r"(.+?)\s+"
    r"(\d{1,2}(?:[.,]\d)?)\s+"
    r"(AA|BA|BB|CB|CC|DC|DD|FD|FF|P|EX|W|I|S|U|NA)\b",
    re.IGNORECASE,
)


def _prepare_text(text: str) -> str:
    """Normalize PDF text: join broken lines and glued digits."""
    text = re.sub(r"(\w)-\n(\w)", r"\1\2", text)
    text = re.sub(r"(?<=[a-z,])\n(?=[a-z])", " ", text)
    prev = None
    while prev != text:
        prev = text
        text = re.sub(r"(\d) (\d)", r"\1\2", text)
    return text


def _is_valid_course_code(code: str) -> bool:
    c = code.replace(" ", "").upper()
    if not c or len(c) < 5:
        return False
    if re.match(r"^(FALL|SPRING|SUMMER|SEMESTER|WINTER|GPA|CREDIT|YEAR)\d*", c):
        return False
    if re.search(r"20\d{2}", c):
        return False
    return bool(re.match(r"^[A-ZÇĞİÖŞÜ]{2,6}\d{3}[A-Z]?$", c))


def _normalize_courses(courses: list) -> list:
    """Drop junk rows (semester headings, code-only, invalid codes)."""
    cleaned: list = []
    for c in courses:
        code = (c.course_code or "").replace(" ", "").upper()
        name = (c.course_name or "").strip()
        if not _is_valid_course_code(code):
            continue
        if not name or name.lower() in {"semester", "unknown course", "course", "code"}:
            continue
        if name.upper().replace(" ", "") == code:
            continue
        cleaned.append(c)
    return cleaned


def _score_courses(courses: list) -> int:
    courses = _normalize_courses(courses)
    if not courses:
        return 0
    total = 0
    for c in courses:
        name = (c.course_name or "").strip()
        if name:
            total += 3
        if c.credits:
            total += 2
        if c.grade:
            total += 1
    return total


# Row labels to skip when reading stacked (one field per line) PDF text
_STACKED_SKIP = frozenset({
    "compulsory", "elective", "optional", "zorunlu", "seçmeli", "secmeli",
    "type", "grade", "credit", "credits", "course title", "course name",
    "course code", "code", "grade point", "grade points", "not", "kredi",
})

# Semester / term heading pattern
_SEMESTER_RE = re.compile(
    r"((?:19|20)\d{2}[-/](?:19|20)?\d{2,4}[\s\-]*(?:güz|bahar|yaz|fall|spring|summer|guz)?)"
    r"|(?:(?:güz|bahar|yaz|guz|fall|spring|summer)\s+(?:19|20)\d{2})"
    r"|(?:[IVX]+[.\s]+yar[iı]y[iı]l)"
    r"|(?:\d+[.\s]+(?:yar[iı]y[iı]l|d[oö]nem|semester))",
    re.IGNORECASE,
)


# ---------------------------------------------------------------------------
# Main parser class
# ---------------------------------------------------------------------------

class TranscriptParser:

    def parse(self, pdf_bytes: bytes) -> TranscriptParseResult:
        result = TranscriptParseResult()

        try:
            text, tables = self._extract_with_pdfplumber(pdf_bytes)
        except Exception as exc:
            logger.warning("pdfplumber failed, falling back to pypdf: %s", exc)
            try:
                text = self._extract_with_pypdf(pdf_bytes)
                tables = []
                result.warnings.append("pdfplumber unavailable; pypdf was used as fallback.")
            except Exception as exc2:
                result.warnings.append(f"Could not read PDF: {exc2}")
                return result

        result.raw_text = text
        prepared = _prepare_text(text)

        candidates: list[tuple[str, list]] = []
        if tables:
            candidates.append(("table", self._parse_tables(tables)))
        candidates.append(("stacked_lines", self._parse_stacked_lines(text)))
        candidates.append(("row_pattern", self._parse_row_pattern(prepared)))
        candidates.append(("line_regex", self._parse_lines(prepared)))
        candidates.append(("heuristic", self._parse_heuristic(prepared)))

        best_strategy, best_courses = max(candidates, key=lambda item: _score_courses(item[1]))
        result.courses = _normalize_courses(best_courses)
        result.parser_strategy = best_strategy
        if _score_courses(best_courses) == 0:
            result.warnings.append(
                "Could not detect a standard transcript format; credits/grades may be missing."
            )
        self._attach_semesters(prepared, result.courses)
        return result

    # ------------------------------------------------------------------
    # PDF extraction layer
    # ------------------------------------------------------------------

    def _extract_with_pdfplumber(self, pdf_bytes: bytes):
        """Extract both plain text and tables using pdfplumber."""
        import pdfplumber
        full_text_parts = []
        all_tables = []
        with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
            for page in pdf.pages:
                full_text_parts.append(page.extract_text() or "")
                for table in page.extract_tables():
                    if table:
                        all_tables.append(table)
        return "\n".join(full_text_parts), all_tables

    def _extract_with_pypdf(self, pdf_bytes: bytes) -> str:
        """Extract plain text only using pypdf (fallback, no table support)."""
        from pypdf import PdfReader
        reader = PdfReader(io.BytesIO(pdf_bytes))
        return "\n".join(page.extract_text() or "" for page in reader.pages)

    # ------------------------------------------------------------------
    # Strategy 1 — Table-based parsing
    # ------------------------------------------------------------------

    def _parse_tables(self, tables) -> list:
        courses = []
        for table in tables:
            if not table or len(table) < 2:
                continue
            header_row = [str(c).strip() if c else "" for c in table[0]]
            if not self._looks_like_course_table(header_row):
                continue
            col = self._map_columns(header_row)
            for row in table[1:]:
                if not row or not any(row):
                    continue
                cells = [str(c).strip() if c else "" for c in row]
                name_idx = col["name"]
                name = cells[name_idx] if name_idx is not None and name_idx < len(cells) else ""
                if not name or len(name) < 3:
                    # Skip header-like rows or empty rows
                    continue

                # Resolve course code: try dedicated column first, then parse from name
                code = None
                if col["code"] is not None and col["code"] < len(cells):
                    raw = cells[col["code"]]
                    m = _CODE_RE.search(raw)
                    code = m.group(1).replace(" ", "").upper() if m else None
                if not code:
                    m = _CODE_RE.search(name)
                    if m:
                        code = m.group(1).replace(" ", "").upper()

                credit = self._extract_credit_from_cells(cells, col)
                grade  = self._extract_grade_from_cells(cells, col)

                cleaned_name = self._clean_course_name(name)
                if not cleaned_name and code:
                    name_parts = []
                    for i, cell in enumerate(cells):
                        if i in (col["code"], col["credits"], col["grade"]):
                            continue
                        if cell and not _GRADE_RE.match(cell.strip().upper()):
                            if not _CREDIT_RE.match(cell.strip()):
                                name_parts.append(cell)
                    cleaned_name = self._clean_course_name(" ".join(name_parts))

                # Skip code-only rows — other strategies will parse the full row
                if not cleaned_name:
                    continue
                if code and cleaned_name.upper().replace(" ", "") == code.replace(" ", ""):
                    continue

                courses.append(ParsedCourse(
                    course_code=code,
                    course_name=cleaned_name,
                    credits=credit,
                    grade=grade,
                    semester=None,
                ))
        return courses

    def _looks_like_course_table(self, header: list) -> bool:
        """Return True if the header row looks like a course listing table."""
        joined = " ".join(header)
        return _contains_any(joined, {"ders", "course", "kod", "code", "kredi", "credit"})

    def _map_columns(self, header: list) -> dict:
        """Map header cell values to column indices for code/name/credits/grade."""
        col = {"code": None, "name": None, "credits": None, "grade": None}
        for i, h in enumerate(header):
            h_norm = _tr_lower(h)
            if _contains_any(h_norm, _CODE_HEADERS) and col["code"] is None:
                col["code"] = i
            if _contains_any(h_norm, _NAME_HEADERS) and col["name"] is None:
                # Avoid assigning a header like "ders kodu" to both code and name
                if col["code"] != i:
                    col["name"] = i
            if _contains_any(h_norm, _CREDIT_HEADERS) and col["credits"] is None:
                col["credits"] = i
            if _contains_any(h_norm, _GRADE_HEADERS) and col["grade"] is None:
                col["grade"] = i

        # Fallback: if name column still not found, use index 1 (or 0 for single-column tables)
        if col["name"] is None:
            col["name"] = 1 if len(header) > 1 else 0
        return col

    # ------------------------------------------------------------------
    # Strategy 1b — Stacked lines (pypdf: code / name / credit / grade per line)
    # ------------------------------------------------------------------

    def _parse_stacked_lines(self, text: str) -> list:
        """
        Parse transcripts where each table cell appears on its own line.

        pypdf (and some pdfplumber text extractions) often emit::

            MATH101
            Calculus I
            4
            Compulsory
            AA
        """
        lines = [line.strip() for line in text.splitlines() if line.strip()]
        courses: list = []
        seen: set[str] = set()
        i = 0

        while i < len(lines):
            line = lines[i]
            code_match = _CODE_RE.search(line)
            if not code_match:
                i += 1
                continue

            code = code_match.group(1).replace(" ", "").upper()
            if not _is_valid_course_code(code):
                i += 1
                continue

            # Only handle lines that contain the course code alone
            if line.upper().replace(" ", "") != code:
                i += 1
                continue

            i += 1
            name_parts: list[str] = []
            credit: Optional[float] = None
            grade: Optional[str] = None

            while i < len(lines):
                current = lines[i]

                next_code = _CODE_RE.search(current)
                if (
                    next_code
                    and _is_valid_course_code(next_code.group(1).replace(" ", "").upper())
                    and current.upper().replace(" ", "") == next_code.group(1).replace(" ", "").upper()
                ):
                    break

                if _SEMESTER_RE.search(current):
                    i += 1
                    continue

                if _tr_lower(current) in _STACKED_SKIP:
                    i += 1
                    continue

                normalized_grade = self._normalize_grade(current)
                if normalized_grade and credit is not None:
                    grade = normalized_grade
                    i += 1
                    break

                parsed_credit = self._parse_credit(current)
                if parsed_credit is not None and credit is None:
                    credit = parsed_credit
                    i += 1
                    continue

                if len(current) > 1 and not _GRADE_RE.match(current.upper()):
                    name_parts.append(current)
                i += 1

            course_name = self._clean_course_name(" ".join(name_parts))
            if not course_name or code in seen:
                continue

            seen.add(code)
            courses.append(ParsedCourse(
                course_code=code,
                course_name=course_name,
                credits=credit,
                grade=grade,
                semester=None,
            ))

        return courses

    # ------------------------------------------------------------------
    # Strategy 2 — Line-based regex parsing
    # ------------------------------------------------------------------

    def _parse_lines(self, text: str) -> list:
        """
        Parse lines that contain a course code.
        Two or more consecutive spaces (or tabs) are treated as column separators.
        """
        courses = []
        lines = text.splitlines()

        for line in lines:
            line = line.strip()
            if len(line) < 8:
                continue
            if _SEMESTER_RE.search(line):
                continue  # skip semester heading lines

            code_match = _CODE_RE.search(line)
            if not code_match:
                continue

            code = code_match.group(1).replace(" ", "").upper()

            # Split on 2+ spaces or tab characters (acts as column delimiter)
            tokens = re.split(r"\s{2,}|\t", line)
            tokens = [t.strip() for t in tokens if t.strip()]

            if len(tokens) < 2:
                continue

            credit = self._find_credit_in_tokens(tokens)
            grade  = self._find_grade_in_tokens(tokens)

            # If neither credit nor grade found, defer to heuristic strategy
            if credit is None and grade is None:
                continue

            # Longest token that is not a number or grade = course name
            name_candidates = [
                t for t in tokens
                if len(t) > 4
                and not _CREDIT_RE.match(t)
                and not _GRADE_RE.match(t)
                and not _CREDIT_COMPOSITE_RE.match(t)
                and not _CODE_RE.fullmatch(t.replace(" ", ""))
            ]
            if not name_candidates:
                continue
            course_name = max(name_candidates, key=len)

            courses.append(ParsedCourse(
                course_code=code,
                course_name=self._clean_course_name(course_name),
                credits=credit,
                grade=grade,
                semester=None,
            ))
        return courses

    # ------------------------------------------------------------------
    # Strategy 2b — Row pattern (CODE Name Credit Grade)
    # ------------------------------------------------------------------

    def _parse_row_pattern(self, text: str) -> list:
        courses = []
        seen: set[str] = set()
        for m in _COURSE_ROW_RE.finditer(text):
            code = m.group(1).replace(" ", "").upper()
            if code in seen:
                continue
            seen.add(code)
            name = self._clean_course_name(m.group(2))
            if not name:
                continue
            credit = self._parse_credit(m.group(3))
            grade = self._normalize_grade(m.group(4))
            courses.append(ParsedCourse(
                course_code=code,
                course_name=name,
                credits=credit,
                grade=grade,
                semester=None,
            ))
        return courses

    # ------------------------------------------------------------------
    # Strategy 3 — Heuristic fallback
    # ------------------------------------------------------------------

    def _parse_heuristic(self, text: str) -> list:
        """
        Last-resort strategy: collect any line containing a course code pattern.
        Credits and grades may be missing in the output.
        """
        courses = []
        seen: set = set()

        for line in text.splitlines():
            line = line.strip()
            m = _CODE_RE.search(line)
            if not m:
                continue
            code = m.group(1).replace(" ", "").upper()
            if code in seen:
                continue
            seen.add(code)

            # Take text after the code match as the course name candidate
            after = line[m.end():].strip(" -:,")
            if len(after) < 3:
                after = line[:m.start()].strip(" -:,")
            if len(after) < 3:
                after = code

            tokens = re.split(r"\s{2,}|\t|\s+", after)
            tokens = [t.strip() for t in tokens if t.strip()]

            credit = self._find_credit_in_tokens(tokens)
            grade  = self._find_grade_in_tokens(tokens)

            # Remove credit/grade tokens from the name
            name_tokens = [
                t for t in tokens
                if not _CREDIT_RE.match(t)
                and not _GRADE_RE.match(t)
                and not _CREDIT_COMPOSITE_RE.match(t)
                and len(t) > 1
            ]
            course_name = " ".join(name_tokens) or after

            courses.append(ParsedCourse(
                course_code=code,
                course_name=self._clean_course_name(course_name),
                credits=credit,
                grade=grade,
                semester=None,
            ))
        return courses

    # ------------------------------------------------------------------
    # Semester attachment
    # ------------------------------------------------------------------

    def _attach_semesters(self, text: str, courses: list) -> None:
        """
        Detect semester headings in the text and assign each course
        to the most recent heading that appears before it.
        """
        if not courses:
            return
        lines = text.splitlines()
        semester_positions: list[tuple[int, str]] = []
        for i, line in enumerate(lines):
            m = _SEMESTER_RE.search(line.strip())
            if m:
                semester_positions.append((i, m.group(0).strip()))
        if not semester_positions:
            return
        for course in courses:
            search_key = course.course_name[:15].lower()
            course_line = None
            for i, line in enumerate(lines):
                if search_key in line.lower():
                    course_line = i
                    break
            if course_line is None:
                continue
            for pos, sem in reversed(semester_positions):
                if pos <= course_line:
                    course.semester = sem
                    break

    # ------------------------------------------------------------------
    # Helper methods
    # ------------------------------------------------------------------

    def _extract_credit_from_cells(self, cells: list, col: dict) -> Optional[float]:
        """Try the dedicated credit column first, then scan all cells."""
        if col["credits"] is not None and col["credits"] < len(cells):
            v = self._parse_credit(cells[col["credits"]])
            if v is not None:
                return v
        for cell in cells:
            v = self._parse_credit(cell)
            if v is not None:
                return v
        return None

    def _extract_grade_from_cells(self, cells: list, col: dict) -> Optional[str]:
        """Try the dedicated grade column first, then scan all cells."""
        if col["grade"] is not None and col["grade"] < len(cells):
            g = self._normalize_grade(cells[col["grade"]])
            if g:
                return g
        for cell in cells:
            g = self._normalize_grade(cell)
            if g:
                return g
        return None

    def _find_credit_in_tokens(self, tokens: list) -> Optional[float]:
        """Scan tokens in reverse order and return the first valid credit value."""
        for t in reversed(tokens):
            v = self._parse_credit(t)
            if v is not None:
                return v
        return None

    def _find_grade_in_tokens(self, tokens: list) -> Optional[str]:
        """Scan tokens in reverse order and return the first valid grade value."""
        for t in reversed(tokens):
            g = self._normalize_grade(t)
            if g:
                return g
        return None

    def _parse_credit(self, text: str) -> Optional[float]:
        """Convert a credit string to float. Valid range: 0.5–12."""
        t = text.strip().strip("()")
        # Handle composite format e.g. "3+0+0"
        m = _CREDIT_COMPOSITE_RE.match(t)
        if m:
            return float(m.group(1))
        # Handle standard numeric format
        m2 = _CREDIT_RE.match(t)
        if m2:
            try:
                v = float(m2.group(1).replace(",", "."))
                if 0.5 <= v <= 12:
                    return v
            except ValueError:
                pass
        return None

    def _normalize_grade(self, text: str) -> Optional[str]:
        """Normalize a grade string; map Turkish aliases to standard values."""
        t = text.strip().upper()
        t_lower = _tr_lower(text.strip())
        if t_lower in _GRADE_ALIASES:
            return _GRADE_ALIASES[t_lower]
        if _GRADE_RE.match(t):
            return t
        return None

    def _clean_course_name(self, name: str) -> str:
        """Strip course codes, punctuation and extra whitespace from a course name."""
        name = _CODE_RE.sub("", name).strip()
        name = name.strip(" -:.,/\\")
        name = re.sub(r"\s+", " ", name)
        return name or ""


# ---------------------------------------------------------------------------
# Module-level convenience function
# ---------------------------------------------------------------------------

def parse_transcript(pdf_bytes: bytes) -> TranscriptParseResult:
    """
    Parse a transcript PDF and return structured course data.

    Usage::

        result = parse_transcript(pdf_bytes)
        for course in result.courses:
            print(course.course_name, course.credits, course.grade)
    """
    return TranscriptParser().parse(pdf_bytes)
