from app.services.intibak_service import _parsed_courses_usable


def test_parsed_courses_usable_rejects_unknown_course():
    assert _parsed_courses_usable([
        {"course_code": "MATH101", "course_name": "Calculus I", "credits": 4},
    ])
    assert not _parsed_courses_usable([
        {"course_code": "MATH101", "course_name": "Unknown Course", "credits": 0},
    ])
    assert not _parsed_courses_usable([])
