"""Real PDF document extractor.

Uses pypdf to extract text from PDFs, then applies regex patterns
to find structured data. Handles both Turkish and English document formats.
Returns an empty dict for document types without structured extraction.
"""
import io
import logging
import re
from typing import Any

from app.domain.enums import DocType

logger = logging.getLogger(__name__)


def _extract_text(file_bytes: bytes) -> str:
    try:
        from pypdf import PdfReader
        reader = PdfReader(io.BytesIO(file_bytes))
        raw = "\n".join(page.extract_text() or "" for page in reader.pages)
        return _normalize(raw)
    except Exception as exc:
        logger.warning("PDF text extraction failed: %s", exc)
        return ""


def _normalize(text: str) -> str:
    """Collapse spaces that pypdf sometimes inserts inside digit sequences."""
    prev = None
    while prev != text:
        prev = text
        text = re.sub(r'(\d) (\d)', r'\1\2', text)
    return text


_REQUIRED_FIELDS: dict[DocType, list[str]] = {
    DocType.TRANSCRIPT:    ["gpa", "completed_credits", "total_credits", "institution"],
    DocType.YKS_RESULT:   ["score", "score_type", "exam_year"],
    DocType.LANGUAGE_CERT: ["exam_type", "score", "expires_on"],
    DocType.ID_COPY:       ["national_id_verified"],
}


class DocumentExtractor:
    async def extract(self, doc_type: DocType, file_bytes: bytes) -> dict[str, Any]:
        text = _extract_text(file_bytes)
        if not text.strip():
            return {}

        if doc_type == DocType.TRANSCRIPT:
            data = _extract_transcript(text)
        elif doc_type == DocType.YKS_RESULT:
            data = _extract_yks(text)
        elif doc_type == DocType.LANGUAGE_CERT:
            data = _extract_language_cert(text)
        elif doc_type == DocType.ID_COPY:
            data = _extract_id_copy(text)
        else:
            data = {}  # no structured extraction — requires manual confirmation

        # Always return what was found; add _missing list when incomplete
        required = _REQUIRED_FIELDS.get(doc_type, [])
        missing = [f for f in required if f not in data]
        if missing:
            data["_missing"] = missing

        return data


def _first(patterns: list[str], text: str, flags: int = re.IGNORECASE) -> re.Match | None:
    for pat in patterns:
        m = re.search(pat, text, flags)
        if m:
            return m
    return None


def _to_float(s: str) -> float:
    return float(s.replace(",", ".").replace(" ", ""))


def _to_int(s: str) -> int:
    return int(s.replace(" ", ""))


# ---------------------------------------------------------------------------
# Transcript
# ---------------------------------------------------------------------------

def _extract_transcript(text: str) -> dict[str, Any]:
    result: dict[str, Any] = {}

    # GPA on a 4.0 scale
    gpa_m = _first([
        # "Cumulative GPA (4.0 scale) 3.50" — optional "(X.X scale)" between label and value
        r"(?:AGNO|GANO|GPA|G\.P\.A\.|Genel A[gğ]ırlıklı Not|Overall GPA|Cumulative GPA)"
        r"(?:\s*\([^)]*\))?\s*[:\s]+([\d.,]+)",
        # "3.50 / 4.00" or "3.50/4.00"
        r"([\d.,]+)\s*/\s*4[.,]0",
    ], text)
    if gpa_m:
        result["gpa"] = round(_to_float(gpa_m.group(1)), 2)

    # Completed credits — handle both "Completed Credits" and "Total Credits Completed"
    completed_m = _first([
        r"(?:Tamamlanan Kredi|Alınan Kredi|Completed Credits?)[:\s]+([\d ]+)",
        r"(?:Total Credits?\s+Completed|TOTAL COMPLETED CREDITS)[:\s]+([\d ]+)",
    ], text)
    if completed_m:
        result["completed_credits"] = _to_int(completed_m.group(1).strip())

    # Total credits for the degree
    total_m = _first([
        r"(?:Total Credits?|Mezuniyet İçin Gereken Kredi|Required Credits?|Total Program Credits?)"
        r"[:\s]+([\d ]+)",
        r"(?:Total Credits?\s+Completed|TOTAL COMPLETED CREDITS)[:\s]+([\d ]+)",
    ], text)
    if total_m:
        result["total_credits"] = _to_int(total_m.group(1).strip())

    # Institution — match a full line that ends with University/Üniversitesi
    inst_m = _first([
        r"^[ \t]*([^\n\r]+(?:Üniversitesi|University))[ \t]*$",
        r"Institution\s*[:\s]+([^\n\r]+)",
    ], text, flags=re.IGNORECASE | re.MULTILINE)
    if inst_m:
        result["institution"] = inst_m.group(1).strip()

    return result


# ---------------------------------------------------------------------------
# YKS Result
# ---------------------------------------------------------------------------

def _extract_yks(text: str) -> dict[str, Any]:
    result: dict[str, Any] = {}

    typed_m = _first([
        r"(SAY|SÖZ|EA|YDT|YDİL|DİL)[:\s]+(?:Puan[ıi]?[:\s]+)?([\d.,]+)",
        r"(SAY|SÖZ|EA|YDT|YDİL|DİL)\s+Puan[ıi]?\s*[:\-]?\s*([\d.,]+)",
    ], text)
    if typed_m:
        score_type = typed_m.group(1).upper().replace("DİL", "YDİL")
        result["score_type"] = score_type
        result["score"] = round(_to_float(typed_m.group(2)), 3)
    else:
        generic_m = _first([
            r"(?:TYT|AYT)\s*(?:Puan[ıi]?)?[:\s]+([\d.,]+)",
            r"(?:Yerleştirme|Yerlestirme)\s*Puan[ıi]?[:\s]+([\d.,]+)",
            r"(?:YKS|ÖSYM|OSYM)\s*(?:Puan[ıi]?)?[:\s]+([\d.,]+)",
            r"(?:Puan[ıi]?|Score|YKS\s*Score)[:\s]+([\d.,]+)",
            r"(?:Toplam|Ham)\s*Puan[ıi]?[:\s]+([\d.,]+)",
            r"\b([3-5]\d{2}(?:[.,]\d{1,3})?)\s*(?:puan|Puan)",
        ], text)
        if generic_m:
            result["score"] = round(_to_float(generic_m.group(1)), 3)

    # Exam year
    year_m = _first([
        r"(20[12]\d)\s*(?:YKS|TYT|AYT)",
        r"(?:YKS|TYT|AYT)\s*(20[12]\d)",
        r"(?:Sınav Yılı|Exam Year)[:\s]+(20[12]\d)",
    ], text)
    if year_m:
        result["exam_year"] = int(year_m.group(1))

    return result


# ---------------------------------------------------------------------------
# Language Certificate
# ---------------------------------------------------------------------------

def _extract_language_cert(text: str) -> dict[str, Any]:
    result: dict[str, Any] = {}

    # Exam type — stored as "exam_type" to match the frontend schema.
    # YÖKDİL / YOKDIL both accepted (pypdf may strip diacritics).
    cert_m = _first([
        r"\b(TOEFL\s*iBT|TOEFL\s*PBT|TOEFL)\b",
        r"\b(IELTS\s*Academic|IELTS\s*General|IELTS)\b",
        r"\b(YDS)\b",
        r"\b(YO[Kk]D[Iİ]L)\b",
        r"\b(COPE|CPE|FCE|CAE|PTE)\b",
    ], text, flags=re.IGNORECASE)
    if cert_m:
        raw = cert_m.group(1).strip().upper()
        # Normalise YOKDIL variants → canonical key used in REQUIRED_SCORE
        if re.match(r"YO[K]?D[I]L", raw, re.IGNORECASE):
            raw = "YOKDIL"
        result["exam_type"] = raw

    score_m = _first([
        r"(?:Total Score|Overall Score|Toplam Puan|Overall Band Score|Band Score|Score|Puan)"
        r"[:\s]+([\d.,]+)",
    ], text)
    if score_m:
        val = _to_float(score_m.group(1))
        result["score"] = int(val) if val == int(val) else round(val, 1)

    # Issue date (when the certificate was granted)
    issued_m = _first([
        r"(?:Issue Date|Date of Issue|Sınav Tarihi|Belge Tarihi|Tarih)[:\s]+"
        r"(\d{1,2}[./\-]\d{1,2}[./\-]\d{2,4})",
        r"(?:Issue Date|Date of Issue|Sınav Tarihi|Belge Tarihi|Tarih)[:\s]+(\d{4}-\d{2}-\d{2})",
    ], text)
    if issued_m:
        result["issued_on"] = issued_m.group(1).strip()

    # Expiry / validity date
    expiry_m = _first([
        r"(?:Valid Until|Expiry Date|Geçerlilik Tarihi)[:\s]+"
        r"(\d{1,2}[./\-]\d{1,2}[./\-]\d{2,4})",
        r"(?:Valid Until|Expiry Date|Geçerlilik Tarihi)[:\s]+(\d{4}-\d{2}-\d{2})",
    ], text)
    if expiry_m:
        result["expires_on"] = expiry_m.group(1).strip()

    return result


# ---------------------------------------------------------------------------
# ID Copy
# ---------------------------------------------------------------------------

def _extract_id_copy(text: str) -> dict[str, Any]:
    id_m = re.search(r"\b([1-9]\d{10})\b", text)
    if id_m:
        return {"national_id_verified": True}
    return {}  # _missing will be added by the caller
