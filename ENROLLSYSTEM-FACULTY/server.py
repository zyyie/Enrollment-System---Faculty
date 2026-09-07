"""
Geranova EMS — Faculty Portal (Teachers)
Run: python server.py
Port: 8003
"""

import http.server
import json
import os
import re
import socketserver
import subprocess
import threading
import webbrowser
from datetime import datetime
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, unquote
from urllib.request import Request, urlopen

PORT = 8003
ROOT = Path(__file__).parent
FACULTY_PORTAL_URL = "http://localhost:8003"
ADMIN_PORTAL_URL = "http://localhost:8001"

TEACHER_SEEDS = [
    {
        "faculty_id": "FAC-STEM-01",
        "last_name": "SANTOS",
        "first_name": "MARIA",
        "role": "Teacher",
        "department": "STEM Department",
        "password": "teacher123",
    },
]


def load_env():
    env = {}
    candidates = [
        ROOT / ".env",
        ROOT.parent / "ENROLLSYSTEM-ADMIN" / ".env",
    ]
    env_path = next((p for p in candidates if p.exists()), None)
    if not env_path:
        return env, None

    raw = env_path.read_text(encoding="utf-8-sig")
    for line in raw.splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        value = value.strip().strip('"').strip("'")
        if " #" in value:
            value = value.split(" #", 1)[0].strip()
        env[key.strip()] = value
    return env, env_path


ENV, ENV_SOURCE = load_env()
SUPABASE_URL = ENV.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_PUBLISHABLE_KEY = ENV.get("SUPABASE_PUBLISHABLE_KEY", "")
SUPABASE_SECRET_KEY = ENV.get("SUPABASE_SECRET_KEY", "")
SCHOOL_NAME = ENV.get("SCHOOL_NAME", "Geranova Senior High School")


def json_response(handler, status, payload):
    content = json.dumps(payload).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(content)))
    handler.end_headers()
    handler.wfile.write(content)


def read_json_body(handler):
    length = int(handler.headers.get("Content-Length", 0))
    if length <= 0:
        return {}
    raw = handler.rfile.read(length)
    return json.loads(raw.decode("utf-8"))


def supabase_configured():
    return bool(SUPABASE_URL and (SUPABASE_SECRET_KEY or SUPABASE_PUBLISHABLE_KEY))


def parse_supabase_error(error):
    if not error:
        return "Unknown Supabase error"
    try:
        data = json.loads(error)
        return data.get("message") or data.get("error") or str(error)
    except json.JSONDecodeError:
        return str(error)[:280]


def supabase_rpc(function_name, params=None, use_secret=True, timeout=15):
    if not SUPABASE_URL:
        return None, "Supabase URL is not configured"

    key = SUPABASE_SECRET_KEY if use_secret and SUPABASE_SECRET_KEY else SUPABASE_PUBLISHABLE_KEY
    if not key:
        return None, "Supabase API key is not configured"

    url = f"{SUPABASE_URL}/rest/v1/rpc/{function_name}"
    payload = json.dumps(params or {}).encode("utf-8")
    request = Request(
        url,
        data=payload,
        headers={
            "Content-Type": "application/json",
            "apikey": key,
            "Authorization": f"Bearer {key}",
        },
        method="POST",
    )

    try:
        with urlopen(request, timeout=timeout) as response:
            raw = response.read().decode("utf-8")
            return (json.loads(raw) if raw else {}), None
    except HTTPError as err:
        detail = err.read().decode("utf-8", errors="ignore")
        return None, detail or err.reason
    except URLError as err:
        return None, str(err.reason)


def supabase_rest_get(table, query_string, use_secret=True, timeout=10):
    if not SUPABASE_URL:
        return None, "Supabase URL is not configured"

    key = SUPABASE_SECRET_KEY if use_secret and SUPABASE_SECRET_KEY else SUPABASE_PUBLISHABLE_KEY
    if not key:
        return None, "Supabase API key is not configured"

    url = f"{SUPABASE_URL}/rest/v1/{table}?{query_string}"
    request = Request(
        url,
        headers={
            "Content-Type": "application/json",
            "apikey": key,
            "Authorization": f"Bearer {key}",
        },
        method="GET",
    )

    try:
        with urlopen(request, timeout=timeout) as response:
            raw = response.read().decode("utf-8")
            return (json.loads(raw) if raw else []), None
    except HTTPError as err:
        detail = err.read().decode("utf-8", errors="ignore")
        return None, detail or err.reason
    except URLError as err:
        return None, str(err.reason)


def supabase_rest_patch(table, query_string, payload, use_secret=True, timeout=15):
    if not SUPABASE_URL:
        return None, "Supabase URL is not configured"

    key = SUPABASE_SECRET_KEY if use_secret and SUPABASE_SECRET_KEY else SUPABASE_PUBLISHABLE_KEY
    if not key:
        return None, "Supabase API key is not configured"

    url = f"{SUPABASE_URL}/rest/v1/{table}?{query_string}"
    body = json.dumps(payload).encode("utf-8")
    request = Request(
        url,
        data=body,
        headers={
            "Content-Type": "application/json",
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Prefer": "return=minimal",
        },
        method="PATCH",
    )
    try:
        with urlopen(request, timeout=timeout) as response:
            return {"success": True}, None
    except HTTPError as err:
        detail = err.read().decode("utf-8", errors="ignore")
        return None, detail or err.reason
    except URLError as err:
        return None, str(err.reason)


def supabase_rest_post(table, payload, use_secret=True, timeout=15):
    if not SUPABASE_URL:
        return None, "Supabase URL is not configured"

    key = SUPABASE_SECRET_KEY if use_secret and SUPABASE_SECRET_KEY else SUPABASE_PUBLISHABLE_KEY
    if not key:
        return None, "Supabase API key is not configured"

    url = f"{SUPABASE_URL}/rest/v1/{table}"
    body = json.dumps(payload).encode("utf-8")
    request = Request(
        url,
        data=body,
        headers={
            "Content-Type": "application/json",
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Prefer": "return=minimal",
        },
        method="POST",
    )
    try:
        with urlopen(request, timeout=timeout) as response:
            return {"success": True}, None
    except HTTPError as err:
        detail = err.read().decode("utf-8", errors="ignore")
        return None, detail or err.reason
    except URLError as err:
        return None, str(err.reason)


def build_config_js():
    enabled = bool(SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY)
    config = {
        "url": SUPABASE_URL,
        "publishableKey": SUPABASE_PUBLISHABLE_KEY,
        "enabled": enabled,
    }
    return "window.SUPABASE_CONFIG = " + json.dumps(config) + ";\n"


def normalize_role(role):
    return (role or "").strip().lower()


def is_teacher_role(role):
    return normalize_role(role) == "teacher"


def is_registrar_role(role):
    role_norm = normalize_role(role)
    return role_norm in ("registrar", "admin", "administrator")


def local_teacher_login(faculty_id, password):
    for seed in TEACHER_SEEDS:
        if faculty_id == seed["faculty_id"] and password == seed["password"]:
            return {
                "id": seed["faculty_id"],
                "lastName": seed["last_name"],
                "firstName": seed["first_name"],
                "middleName": "",
                "role": seed["role"],
                "department": seed["department"],
                "lastLogin": datetime.now().strftime("%b %d, %Y %I:%M %p"),
            }
    return None


def handle_faculty_login(handler):
    try:
        body = read_json_body(handler)
    except json.JSONDecodeError:
        json_response(handler, 400, {"success": False, "error": "Invalid request body."})
        return

    faculty_id = (body.get("facultyId") or "").strip().upper()
    password = body.get("password") or ""

    if not faculty_id or not password:
        json_response(handler, 400, {"success": False, "error": "Faculty ID and password are required."})
        return

    faculty = None
    if supabase_configured():
        result, error = supabase_rpc("authenticate_faculty", {
            "p_faculty_id": faculty_id,
            "p_password": password,
        })
        if not error and isinstance(result, dict) and result.get("id"):
            faculty = result

    if not faculty:
        faculty = local_teacher_login(faculty_id, password)

    if not faculty:
        json_response(handler, 401, {"success": False, "error": "Invalid Faculty ID or password."})
        return

    if is_registrar_role(faculty.get("role")):
        json_response(handler, 403, {
            "success": False,
            "error": f"Registrar accounts use the Admin Portal at {ADMIN_PORTAL_URL}",
        })
        return

    if not is_teacher_role(faculty.get("role")):
        json_response(handler, 403, {
            "success": False,
            "error": "This portal is for teachers only.",
        })
        return

    json_response(handler, 200, {"success": True, "faculty": faculty})


def parse_query(handler):
    query = handler.path.split("?", 1)[-1] if "?" in handler.path else ""
    parsed = parse_qs(query, keep_blank_values=True)
    return {key: (values[0] if values else "") for key, values in parsed.items()}


def resolve_faculty_uuid(faculty_id_text):
    if not faculty_id_text:
        return None
    rows, error = supabase_rest_get(
        "faculty",
        f"faculty_id=eq.{faculty_id_text.upper()}&select=id,faculty_id,first_name,last_name,department,role",
    )
    if error or not rows:
        return None
    return rows[0]


def get_current_semester_id():
    rows, error = supabase_rest_get(
        "semesters",
        "is_current=eq.true&select=id&limit=1",
    )
    if not error and rows:
        return rows[0].get("id")
    rows, error = supabase_rest_get(
        "semesters",
        "select=id&order=start_date.desc.nullslast&limit=1",
    )
    if not error and rows:
        return rows[0].get("id")
    return None


def _enrollment_status_csv(include_pending=True):
    if include_pending:
        return "enrolled,pending,approved"
    return "enrolled,approved"


def _enrollment_status_allowed(include_pending=True):
    if include_pending:
        return {"enrolled", "pending", "approved"}
    return {"enrolled", "approved"}


def _is_allowed_enrollment_status(status, include_pending=True):
    return (status or "").strip().lower() in _enrollment_status_allowed(include_pending)


def get_teacher_schedule_rows(faculty_uuid):
    rows, error = supabase_rest_get(
        "class_schedules",
        f"faculty_id=eq.{faculty_uuid}&is_active=eq.true"
        "&select=id,subject_id,section_id,schedule_label,enrolled_count,max_slots,"
        "subjects(code,name,grade_level),sections(name,grade_level)",
    )
    if error:
        return []
    return rows or []


def _teacher_slot_map(schedule_rows):
    slot_map = {}
    for row in schedule_rows or []:
        section_id = row.get("section_id")
        subject_id = row.get("subject_id")
        schedule_id = row.get("id")
        if section_id and subject_id and schedule_id:
            slot_map[(section_id, subject_id)] = schedule_id
    return slot_map


def _student_key_from_record(student):
    student = _normalize_student_record(student)
    if not _is_active_student_record(student):
        return None
    text_id = (student.get("student_id") or "").strip()
    return text_id.upper() if text_id else None


def _count_students_in_teacher_sections(faculty_uuid, semester_id):
    schedule_rows = get_teacher_schedule_rows(faculty_uuid)
    section_ids = list({str(r.get("section_id")) for r in schedule_rows if r.get("section_id")})
    if not section_ids or not semester_id:
        return 0

    statuses = _enrollment_status_csv(True)
    sec_csv = ",".join(section_ids)
    rows, error = supabase_rest_get(
        "enrollments",
        f"section_id=in.({sec_csv})&semester_id=eq.{semester_id}&status=in.({statuses})"
        "&select=student_id",
        timeout=15,
    )
    if error or not rows:
        return 0

    student_uuids = {row.get("student_id") for row in rows if row.get("student_id")}
    students = _fetch_students_map(student_uuids)
    keys = set()
    for student_uuid in student_uuids:
        key = _student_key_from_record(students.get(student_uuid))
        if key:
            keys.add(key)
    return len(keys)


def _section_enrollment_totals(faculty_uuid, semester_id):
    schedule_rows = get_teacher_schedule_rows(faculty_uuid)
    section_ids = list({str(r.get("section_id")) for r in schedule_rows if r.get("section_id")})
    if not section_ids or not semester_id:
        return {}

    statuses = _enrollment_status_csv(True)
    sec_csv = ",".join(section_ids)
    rows, error = supabase_rest_get(
        "enrollments",
        f"section_id=in.({sec_csv})&semester_id=eq.{semester_id}&status=in.({statuses})"
        "&select=section_id,student_id",
        timeout=15,
    )
    if error or not rows:
        return {}

    student_uuids = {row.get("student_id") for row in rows if row.get("student_id")}
    students = _fetch_students_map(student_uuids)
    totals = {}
    seen = {}
    for row in rows:
        section_id = str(row.get("section_id") or "")
        if not section_id:
            continue
        key = _student_key_from_record(students.get(row.get("student_id")))
        if not key:
            continue
        seen.setdefault(section_id, set()).add(key)
    for section_id, keys in seen.items():
        totals[section_id] = len(keys)
    return totals


def _normalize_student_record(student):
    if isinstance(student, list):
        student = student[0] if student else None
    if not isinstance(student, dict):
        return None
    return student


def _fetch_students_map(student_uuids):
    if not student_uuids:
        return {}

    result = {}
    id_list = list(student_uuids)
    chunk_size = 80
    for offset in range(0, len(id_list), chunk_size):
        chunk = id_list[offset:offset + chunk_size]
        csv = ",".join(chunk)
        rows, error = supabase_rest_get(
            "students",
            f"id=in.({csv})"
            "&select=id,student_id,last_name,first_name,grade_level,is_active,account_status,strands(code)",
            timeout=15,
        )
        if error or not rows:
            continue
        for row in rows:
            row_id = row.get("id")
            if row_id:
                result[row_id] = row
    return result


def _fetch_enrollments_map(enrollment_ids, semester_id, include_pending=True):
    if not enrollment_ids or not semester_id:
        return {}

    statuses = _enrollment_status_csv(include_pending)
    raw_enrollments = {}
    student_uuids = set()
    id_list = list(enrollment_ids)
    chunk_size = 80
    for offset in range(0, len(id_list), chunk_size):
        chunk = id_list[offset:offset + chunk_size]
        enr_csv = ",".join(chunk)
        rows, error = supabase_rest_get(
            "enrollments",
            f"id=in.({enr_csv})&status=in.({statuses})&semester_id=eq.{semester_id}"
            "&select=id,status,semester_id,section_id,student_id",
            timeout=15,
        )
        if error or not rows:
            continue
        for row in rows:
            row_id = row.get("id")
            if not row_id:
                continue
            raw_enrollments[row_id] = row
            if row.get("student_id"):
                student_uuids.add(row["student_id"])

    students_by_id = _fetch_students_map(student_uuids)
    result = {}
    for enr_id, row in raw_enrollments.items():
        student = students_by_id.get(row.get("student_id"))
        if not student:
            continue
        merged = {**row, "students": student}
        if _student_enrollment_key(merged):
            result[enr_id] = merged
    return result


def _merge_teacher_enrollment_row(merged, seen, class_schedule_id, enrollment_id, enrollment):
    if not class_schedule_id or not enrollment_id or not enrollment:
        return
    key = _student_enrollment_key(enrollment)
    if not key:
        return
    dedupe_key = (str(class_schedule_id), key)
    if dedupe_key in seen:
        return
    seen.add(dedupe_key)
    merged.append({
        "class_schedule_id": class_schedule_id,
        "enrollment_id": enrollment_id,
        "enrollments": enrollment,
    })


def _fetch_teacher_enrollment_rows(schedule_ids, semester_id=None, include_pending=True, schedule_rows=None):
    if not schedule_ids:
        return []
    if not semester_id:
        semester_id = get_current_semester_id()
    if not semester_id:
        return []

    merged = []
    seen = set()

    ids_csv = ",".join(schedule_ids)
    es_rows, es_error = supabase_rest_get(
        "enrollment_subjects",
        f"class_schedule_id=in.({ids_csv})"
        f"{_enrollment_subject_status_filter()}"
        "&select=class_schedule_id,enrollment_id,subject_id",
        timeout=15,
    )
    if not es_error and es_rows:
        enrollment_ids = {row.get("enrollment_id") for row in es_rows if row.get("enrollment_id")}
        enrollments_by_id = _fetch_enrollments_map(enrollment_ids, semester_id, include_pending)
        for row in es_rows:
            enrollment = enrollments_by_id.get(row.get("enrollment_id"))
            if not enrollment:
                continue
            _merge_teacher_enrollment_row(
                merged,
                seen,
                row.get("class_schedule_id"),
                row.get("enrollment_id"),
                enrollment,
            )

    return merged


def _fetch_teacher_enrollment_rows_fallback(schedule_ids, semester_id, include_pending=True, schedule_rows=None):
    return _fetch_teacher_enrollment_rows(
        schedule_ids,
        semester_id,
        include_pending,
        schedule_rows=schedule_rows,
    )


def _student_enrollment_key(enrollment):
    """Distinct key = students.student_id text only (never enrollment UUID)."""
    if not enrollment:
        return None
    student = _normalize_student_record(enrollment.get("students"))
    if not student:
        return None
    if not _is_active_student_record(student):
        return None
    text_id = (student.get("student_id") or "").strip()
    return text_id.upper() if text_id else None


def _is_active_student_record(student):
    if not student:
        return False
    if student.get("is_active") is False:
        return False
    status = (student.get("account_status") or "active").strip().lower()
    return status not in ("inactive", "frozen", "deleted")


def _enrollment_subject_status_filter():
    return "&or=(status.eq.enrolled,status.eq.completed,status.is.null)"


def fetch_teacher_enrollment_stats(schedule_ids, semester_id=None, include_pending=True, schedule_rows=None):
    """Per-class counts and distinct active student total in one pass."""
    if not schedule_ids:
        return {"classCounts": {}, "totalStudents": 0}
    if not semester_id:
        semester_id = get_current_semester_id()
    if not semester_id:
        return {"classCounts": {sid: 0 for sid in schedule_ids}, "totalStudents": 0}

    per_class = {str(sid): set() for sid in schedule_ids}
    all_students = set()
    for row in _fetch_teacher_enrollment_rows(
        schedule_ids,
        semester_id,
        include_pending,
        schedule_rows=schedule_rows,
    ):
        cs_id = str(row.get("class_schedule_id") or "")
        enrollment = row.get("enrollments") or {}
        key = _student_enrollment_key(enrollment)
        if not key or cs_id not in per_class:
            continue
        per_class[cs_id].add(key)
        all_students.add(key)

    return {
        "classCounts": {sid: len(keys) for sid, keys in per_class.items()},
        "totalStudents": len(all_students),
    }


def fetch_teacher_enrollment_stats_rpc(faculty_id):
    result, error = supabase_rpc(
        "get_teacher_enrollment_stats",
        {"p_faculty_id": faculty_id},
        timeout=15,
    )
    if error or result is None:
        return None
    if isinstance(result, list):
        result = result[0] if result else {}
    if not isinstance(result, dict):
        return None

    raw_counts = result.get("classCounts") or {}
    if isinstance(raw_counts, str):
        try:
            raw_counts = json.loads(raw_counts)
        except json.JSONDecodeError:
            raw_counts = {}

    class_counts = {}
    if isinstance(raw_counts, dict):
        for key, value in raw_counts.items():
            class_counts[str(key)] = int(value or 0)

    return {
        "totalStudents": int(result.get("totalStudents") or 0),
        "classCounts": class_counts,
    }


def fetch_schedule_enrollment_counts(schedule_ids, semester_id=None, include_pending=True, schedule_rows=None):
    stats = fetch_teacher_enrollment_stats(
        schedule_ids,
        semester_id,
        include_pending,
        schedule_rows=schedule_rows,
    )
    return stats.get("classCounts") or {}


def fetch_teacher_distinct_students(schedule_ids, semester_id=None, include_pending=True):
    stats = fetch_teacher_enrollment_stats(schedule_ids, semester_id, include_pending)
    return stats.get("totalStudents") or 0


def get_teacher_class_schedule_ids(faculty_uuid):
    rows, error = supabase_rest_get(
        "class_schedules",
        f"faculty_id=eq.{faculty_uuid}&is_active=eq.true&select=id",
    )
    if error:
        return []
    return [row["id"] for row in (rows or []) if row.get("id")]


def get_teacher_enrollment_ids(faculty_uuid, statuses=("enrolled",)):
    schedule_rows = get_teacher_schedule_rows(faculty_uuid)
    schedule_ids = [row["id"] for row in schedule_rows if row.get("id")]
    if not schedule_ids:
        return set()

    include_pending = "pending" in {s.lower() for s in statuses} or "approved" in {s.lower() for s in statuses}
    allowed_statuses = {s.lower() for s in statuses}
    enrollment_ids = set()
    for row in _fetch_teacher_enrollment_rows(
        schedule_ids,
        include_pending=include_pending,
        schedule_rows=schedule_rows,
    ):
        enrollment = row.get("enrollments") or {}
        if (enrollment.get("status") or "").lower() not in allowed_statuses:
            continue
        if not _student_enrollment_key(enrollment):
            continue
        enrollment_id = row.get("enrollment_id") or enrollment.get("id")
        if enrollment_id:
            enrollment_ids.add(enrollment_id)
    return enrollment_ids


def fetch_students_for_grading_rest(grade_level=None, strand_code=None, statuses=("enrolled",)):
    sem_rows, sem_error = supabase_rest_get(
        "semesters",
        "is_current=eq.true&select=id,name&limit=1",
    )
    if sem_error or not sem_rows:
        return []

    sem = sem_rows[0]
    status_filter = ",".join(statuses)
    rows, error = supabase_rest_get(
        "enrollments",
        f"status=in.({status_filter})&semester_id=eq.{sem['id']}"
        "&select=id,status,students(student_id,last_name,first_name,grade_level,strands(code))",
    )
    if error or not rows:
        return []

    students = []
    for row in rows:
        st = row.get("students") or {}
        strand = (st.get("strands") or {}).get("code") or ""
        gl = st.get("grade_level") or ""
        if grade_level and gl != grade_level:
            continue
        if strand_code and strand.upper() != strand_code.upper():
            continue
        students.append({
            "studentId": st.get("student_id") or "",
            "student": f"{st.get('last_name', '')}, {st.get('first_name', '')}".strip(", "),
            "gradeLevel": gl,
            "strand": strand,
            "enrollmentId": row.get("id"),
            "semester": sem.get("name") or "",
        })

    students.sort(key=lambda s: s.get("student") or "")
    return students


FACULTY_ID_STRAND_HINTS = (
    ("ICT", "ICT"),
    ("STEM", "STEM"),
    ("ABM", "ABM"),
    ("HUM", "HUMSS"),
    ("CK", "COOKERY"),
    ("EIM", "EIM"),
    ("COOKERY", "COOKERY"),
)


def _teacher_strand_codes(faculty_uuid):
    rows, error = supabase_rest_get(
        "faculty_strands",
        f"faculty_id=eq.{faculty_uuid}&select=strands(code)",
    )
    if error or not rows:
        return set()
    codes = set()
    for row in rows:
        code = (row.get("strands") or {}).get("code")
        if code:
            codes.add(str(code).upper())
    return codes


def infer_strand_codes_from_faculty_id(faculty_id_text):
    text = (faculty_id_text or "").upper()
    codes = set()
    for hint, strand in FACULTY_ID_STRAND_HINTS:
        if hint in text:
            codes.add(strand)
    return codes


def teacher_strand_codes(faculty_uuid, faculty_id_text):
    codes = _teacher_strand_codes(faculty_uuid)
    codes |= infer_strand_codes_from_faculty_id(faculty_id_text)
    return codes


def parse_rpc_json_list(result):
    if result is None:
        return []
    if isinstance(result, list):
        return result
    if isinstance(result, str):
        try:
            parsed = json.loads(result)
            return parsed if isinstance(parsed, list) else []
        except json.JSONDecodeError:
            return []
    return []


def fetch_teacher_students_for_grading_rest(faculty_id_text, grade_level=None):
    faculty_row = resolve_faculty_uuid(faculty_id_text)
    if not faculty_row:
        return fetch_students_for_grading_rest(
            grade_level,
            None,
            statuses=("enrolled", "approved", "pending"),
        )

    teacher_strands = teacher_strand_codes(faculty_row["id"], faculty_id_text)
    allowed_enrollment_ids = get_teacher_enrollment_ids(
        faculty_row["id"],
        statuses=("enrolled", "approved", "pending"),
    )
    candidates = fetch_students_for_grading_rest(
        grade_level,
        None,
        statuses=("enrolled", "approved", "pending"),
    )
    if not candidates:
        return []

    filtered = []
    seen = set()
    for student in candidates:
        enrollment_id = student.get("enrollmentId")
        if not enrollment_id or enrollment_id in seen:
            continue
        strand = (student.get("strand") or "").upper()
        if enrollment_id in allowed_enrollment_ids or not teacher_strands or strand in teacher_strands:
            seen.add(enrollment_id)
            filtered.append(student)

    if not filtered and candidates and teacher_strands:
        for student in candidates:
            enrollment_id = student.get("enrollmentId")
            if not enrollment_id or enrollment_id in seen:
                continue
            strand = (student.get("strand") or "").upper()
            if strand in teacher_strands:
                seen.add(enrollment_id)
                filtered.append(student)

    return filtered


def section_display_name(full_name):
    text = (full_name or "").strip()
    if "-" in text:
        return text.rsplit("-", 1)[-1].strip().upper()
    parts = [part for part in text.split() if part]
    return (parts[-1] if parts else text).upper()


def fetch_students_for_section(section_id, grade_level=None):
    sem_id = get_current_semester_id()
    if not sem_id or not section_id:
        return []

    rows, error = supabase_rest_get(
        "enrollments",
        f"section_id=eq.{section_id}&semester_id=eq.{sem_id}"
        "&status=in.(enrolled,approved,pending)"
        "&select=id,students(student_id,last_name,first_name,grade_level,strands(code),is_active,account_status)",
    )
    if error or not rows:
        return []

    students = []
    for row in rows:
        st = row.get("students") or {}
        if not _is_active_student_record(st):
            continue
        gl = st.get("grade_level") or ""
        if grade_level and gl != grade_level:
            continue
        strand = (st.get("strands") or {}).get("code") or ""
        students.append({
            "studentId": st.get("student_id") or "",
            "student": f"{st.get('last_name', '')}, {st.get('first_name', '')}".strip(", "),
            "gradeLevel": gl,
            "strand": strand,
            "enrollmentId": row.get("id"),
        })

    students.sort(key=lambda s: s.get("student") or "")
    return students


def build_grades_sections(faculty_id_text, grade_level=None):
    faculty_row = resolve_faculty_uuid(faculty_id_text)
    if not faculty_row:
        students = fetch_students_for_grading_rest(
            grade_level,
            None,
            statuses=("enrolled", "approved", "pending"),
        )
        if faculty_id_text:
            strands = infer_strand_codes_from_faculty_id(faculty_id_text)
            if strands:
                students = [s for s in students if (s.get("strand") or "").upper() in strands]
        if not students:
            return []
        teacher_name = faculty_id_text
        return [{
            "sectionId": "all",
            "sectionName": "ALL SECTIONS",
            "sectionLabel": "All enrolled students",
            "subjects": [],
            "teacherName": teacher_name,
            "scheduleIds": [],
            "studentCount": len(students),
            "students": students,
        }]

    teacher_name = f"{faculty_row.get('last_name', '')}, {faculty_row.get('first_name', '')}".strip(", ")

    query = (
        f"faculty_id=eq.{faculty_row['id']}&is_active=eq.true"
        "&select=id,subject_id,section_id,semester_id,schedule_label,"
        "subjects(code,name,grade_level),sections(id,name,grade_level),"
        "semesters(name,code)"
    )
    rows, error = supabase_rest_get("class_schedules", query)
    if error:
        rows = []

    cards = []
    for row in rows or []:
        sec = row.get("sections") or {}
        sub = row.get("subjects") or {}
        sem = row.get("semesters") or {}
        sec_id = sec.get("id")
        schedule_id = row.get("id")
        schedule_semester_id = row.get("semester_id")
        if not sec_id or not schedule_id:
            continue
        sec_grade = sec.get("grade_level") or ""
        sub_grade = sub.get("grade_level") or ""
        if grade_level:
            if sec_grade and sec_grade != grade_level:
                continue
            if not sec_grade and sub_grade and sub_grade != grade_level:
                continue

        full_name = sec.get("name") or ""
        sub_code = (sub.get("code") or "").strip()
        sub_name = (sub.get("name") or sub_code or "").strip()
        schedule_ids = [schedule_id]
        students = _students_from_schedules(
            schedule_ids,
            grade_level,
            schedule_rows=[row],
            semester_id=schedule_semester_id,
        )

        cards.append({
            "cardId": str(schedule_id),
            "sectionId": sec_id,
            "scheduleId": schedule_id,
            "sectionLabel": full_name,
            "sectionName": section_display_name(full_name),
            "subjectCode": sub_code,
            "subjectName": sub_name,
            "subjects": [sub_name] if sub_name else [],
            "scheduleIds": schedule_ids,
            "students": students,
            "studentCount": len(students),
            "teacherName": teacher_name,
            "scheduleLabel": row.get("schedule_label") or "",
            "semesterId": schedule_semester_id,
            "semesterName": sem.get("name") or "",
            "semesterCode": sem.get("code") or "",
        })

    def _semester_sort_key(item):
        code = (item.get("semesterCode") or "").lower()
        if code in ("1st", "first"):
            return (0, item.get("sectionName") or "", item.get("subjectCode") or "")
        if code in ("2nd", "second"):
            return (1, item.get("sectionName") or "", item.get("subjectCode") or "")
        return (2, item.get("sectionName") or "", item.get("subjectCode") or "")

    cards.sort(key=_semester_sort_key)

    if not cards:
        students = fetch_teacher_students_for_grading_rest(faculty_id_text, grade_level)
        if students:
            cards.append({
                "cardId": "all",
                "sectionId": "all",
                "scheduleId": None,
                "sectionName": "ALL SECTIONS",
                "sectionLabel": "All enrolled students",
                "subjectCode": "",
                "subjectName": "",
                "subjects": [],
                "teacherName": teacher_name,
                "scheduleIds": [],
                "studentCount": len(students),
                "students": students,
                "scheduleLabel": "",
            })

    return cards


def _students_from_schedules(schedule_ids, grade_level=None, schedule_rows=None, semester_id=None):
    if not schedule_ids:
        return []
    if not semester_id and schedule_rows:
        sem_ids = {row.get("semester_id") for row in schedule_rows if row.get("semester_id")}
        if len(sem_ids) == 1:
            semester_id = next(iter(sem_ids))
    if not semester_id:
        semester_id = get_current_semester_id()
    if not semester_id:
        return []
    rows = _fetch_teacher_enrollment_rows(
        schedule_ids,
        semester_id,
        include_pending=True,
        schedule_rows=schedule_rows,
    )
    if not rows:
        return []

    seen = set()
    students = []
    for row in rows:
        enrollment = row.get("enrollments") or {}
        if not _is_allowed_enrollment_status(enrollment.get("status"), include_pending=True):
            continue
        st = enrollment.get("students") or {}
        if not _is_active_student_record(st):
            continue
        gl = st.get("grade_level") or ""
        if grade_level and gl != grade_level:
            continue
        enrollment_id = enrollment.get("id")
        if not enrollment_id or enrollment_id in seen:
            continue
        seen.add(enrollment_id)
        strand = (st.get("strands") or {}).get("code") or ""
        students.append({
            "studentId": st.get("student_id") or "",
            "student": f"{st.get('last_name', '')}, {st.get('first_name', '')}".strip(", "),
            "gradeLevel": gl,
            "strand": strand,
            "enrollmentId": enrollment_id,
        })

    students.sort(key=lambda s: s.get("student") or "")
    return students


def handle_get_grades_sections(handler):
    params = parse_query(handler)
    if not supabase_configured():
        json_response(handler, 503, {"success": False, "error": "Supabase not configured"})
        return

    grade_level = params.get("gradeLevel") or None
    faculty_id = (params.get("facultyId") or "").strip().upper()
    if not faculty_id:
        json_response(handler, 400, {"success": False, "error": "facultyId required"})
        return

    sections = build_grades_sections(faculty_id, grade_level)
    json_response(handler, 200, {"success": True, "data": sections})


def handle_get_students_for_grading(handler):
    params = parse_query(handler)
    if not supabase_configured():
        json_response(handler, 503, {"success": False, "error": "Supabase not configured"})
        return

    grade_level = params.get("gradeLevel") or None
    strand_code = params.get("strand") or None
    faculty_id = (params.get("facultyId") or "").strip().upper()

    if faculty_id:
        students = fetch_teacher_students_for_grading_rest(faculty_id, grade_level)
        if not students:
            result, error = supabase_rpc("get_teacher_students_for_grading", {
                "p_faculty_id": faculty_id,
                "p_grade_level": grade_level,
            }, timeout=15)
            if not error:
                students = parse_rpc_json_list(result)
        if not students:
            students = fetch_students_for_grading_rest(
                grade_level,
                None,
                statuses=("enrolled", "approved", "pending"),
            )
            faculty_row = resolve_faculty_uuid(faculty_id)
            if faculty_row:
                teacher_strands = teacher_strand_codes(faculty_row["id"], faculty_id)
                if teacher_strands:
                    students = [
                        s for s in students
                        if (s.get("strand") or "").upper() in teacher_strands
                    ]
        json_response(handler, 200, {"success": True, "data": students})
        return

    result, error = supabase_rpc("get_students_for_grading", {
        "p_grade_level": grade_level,
        "p_strand_code": strand_code,
    }, timeout=15)

    if error:
        students = fetch_students_for_grading_rest(
            grade_level,
            strand_code,
            statuses=("enrolled", "approved", "pending"),
        )
    else:
        students = parse_rpc_json_list(result)

    json_response(handler, 200, {"success": True, "data": students})


def handle_get_grades_sheet(handler):
    params = parse_query(handler)
    enrollment_id = params.get("enrollmentId")
    if not enrollment_id:
        json_response(handler, 400, {"success": False, "error": "enrollmentId required"})
        return
    if not supabase_configured():
        json_response(handler, 503, {"success": False, "error": "Supabase not configured"})
        return

    result, error = supabase_rpc("get_enrollment_grades_sheet", {
        "p_enrollment_id": enrollment_id,
    }, timeout=15)
    if error:
        json_response(handler, 500, {"success": False, "error": parse_supabase_error(error)})
        return

    sheet = result if isinstance(result, list) else []
    faculty_id = (params.get("facultyId") or "").strip().upper()
    schedule_id = (params.get("scheduleId") or "").strip()
    if faculty_id and sheet:
        faculty_row = resolve_faculty_uuid(faculty_id)
        if faculty_row:
            schedule_ids = set(get_teacher_class_schedule_ids(faculty_row["id"]))
            if schedule_id:
                schedule_ids = {sid for sid in schedule_ids if str(sid) == schedule_id}
            if schedule_ids:
                ids_csv = ",".join(schedule_ids)
                es_rows, es_error = supabase_rest_get(
                    "enrollment_subjects",
                    f"enrollment_id=eq.{enrollment_id}&class_schedule_id=in.({ids_csv})&select=id,subject_id",
                )
                if not es_error and es_rows:
                    allowed_es = {row["id"] for row in es_rows}
                    filtered = []
                    for row in sheet:
                        es_id = row.get("enrollmentSubjectId")
                        if es_id in allowed_es:
                            filtered.append(row)
                    sheet = filtered

    json_response(handler, 200, {"success": True, "data": sheet})


def handle_save_grades(handler):
    try:
        body = read_json_body(handler)
    except json.JSONDecodeError:
        json_response(handler, 400, {"success": False, "error": "Invalid request body"})
        return
    if not supabase_configured():
        json_response(handler, 503, {"success": False, "error": "Supabase not configured"})
        return

    result, error = supabase_rpc("save_student_grades", {
        "p_enrollment_id": body.get("enrollmentId"),
        "p_faculty_id": body.get("facultyId", ""),
        "p_grades": body.get("grades") or [],
    }, timeout=20)
    if error:
        json_response(handler, 500, {"success": False, "error": parse_supabase_error(error)})
        return
    json_response(handler, 200, {"success": True, "data": result})


GRADING_SHEET_SCORE_KEYS = (
    "assignment", "quiz", "seatwork", "activity", "recitation",
    "performanceActivity", "project", "presentation", "groupActivity",
    "laboratoryActivity", "reporting",
    "midtermExam", "finalExam",
    "attendance", "participation", "behaviorConduct", "classStanding",
)

GRADING_SHEET_DB_COLUMNS = {
    "assignment": "assignment",
    "quiz": "quiz",
    "seatwork": "seatwork",
    "activity": "activity",
    "recitation": "recitation",
    "performanceActivity": "performance_activity",
    "project": "project",
    "presentation": "presentation",
    "groupActivity": "group_activity",
    "laboratoryActivity": "laboratory_activity",
    "reporting": "reporting",
    "midtermExam": "midterm_exam",
    "finalExam": "final_exam",
    "attendance": "attendance",
    "participation": "participation",
    "behaviorConduct": "behavior_conduct",
    "classStanding": "class_standing",
}


def _grading_sheet_score_payload(row):
    payload = {}
    for key in GRADING_SHEET_SCORE_KEYS:
        value = row.get(key)
        if value is None or value == "":
            payload[key] = None
        else:
            try:
                payload[key] = float(value)
            except (TypeError, ValueError):
                payload[key] = None
    return payload


def _normalize_grading_sheet_filter_row(row):
    sem = row.get("semesters") or {}
    sy = sem.get("school_years") or {}
    sec = row.get("sections") or {}
    strand = sec.get("strands") or {}
    sub = row.get("subjects") or {}
    return {
        "scheduleId": row.get("id"),
        "schoolYearId": sy.get("id"),
        "schoolYearLabel": sy.get("label") or "",
        "semesterId": sem.get("id") or row.get("semester_id"),
        "semesterName": sem.get("name") or "",
        "semesterCode": sem.get("code") or "",
        "gradeLevel": sec.get("grade_level") or "",
        "strandCode": strand.get("code") or "",
        "sectionId": sec.get("id") or row.get("section_id"),
        "sectionName": sec.get("name") or "",
        "subjectId": sub.get("id") or row.get("subject_id"),
        "subjectCode": sub.get("code") or "",
        "subjectName": sub.get("name") or "",
    }


def fetch_grading_sheet_filters_rest(faculty_id_text):
    faculty_row = resolve_faculty_uuid(faculty_id_text)
    if not faculty_row:
        return []

    query = (
        f"faculty_id=eq.{faculty_row['id']}&is_active=eq.true"
        "&select=id,semester_id,subject_id,section_id,"
        "semesters(id,name,code,school_years(id,label)),"
        "sections(id,name,grade_level,strands(code)),"
        "subjects(id,code,name)"
    )
    rows, error = supabase_rest_get("class_schedules", query, timeout=15)
    if error or not rows:
        return []

    options = [_normalize_grading_sheet_filter_row(row) for row in rows]
    options.sort(key=lambda item: (
        item.get("schoolYearLabel") or "",
        item.get("semesterCode") or "",
        item.get("gradeLevel") or "",
        item.get("strandCode") or "",
        item.get("sectionName") or "",
        item.get("subjectCode") or "",
    ), reverse=False)
    return options


def _verify_faculty_schedule(faculty_id_text, schedule_id):
    faculty_row = resolve_faculty_uuid(faculty_id_text)
    if not faculty_row or not schedule_id:
        return None, None
    rows, error = supabase_rest_get(
        "class_schedules",
        f"id=eq.{schedule_id}&faculty_id=eq.{faculty_row['id']}&is_active=eq.true"
        "&select=id,semester_id,subject_id,section_id,"
        "semesters(id,name,code,school_years(label)),"
        "sections(name,grade_level,strands(code)),"
        "subjects(code,name)",
        timeout=15,
    )
    if error or not rows:
        return None, None
    return faculty_row, rows[0]


def fetch_grading_sheet_rest(faculty_id_text, schedule_id):
    faculty_row, schedule_row = _verify_faculty_schedule(faculty_id_text, schedule_id)
    if not schedule_row:
        return None

    section_id = schedule_row.get("section_id")
    subject_id = schedule_row.get("subject_id")
    semester_id = schedule_row.get("semester_id")
    if not section_id or not semester_id:
        return None

    enr_rows, enr_error = supabase_rest_get(
        "enrollments",
        f"section_id=eq.{section_id}&semester_id=eq.{semester_id}&status=eq.enrolled"
        "&select=id,student_id,students(student_id,last_name,first_name,is_active,account_status)",
        timeout=15,
    )
    if enr_error:
        return None

    es_by_enrollment = {}
    enrollment_ids = [row.get("id") for row in (enr_rows or []) if row.get("id")]
    if enrollment_ids and subject_id:
        es_csv = ",".join(enrollment_ids)
        es_rows, es_error = supabase_rest_get(
            "enrollment_subjects",
            f"enrollment_id=in.({es_csv})&subject_id=eq.{subject_id}"
            f"{_enrollment_subject_status_filter()}"
            "&select=id,enrollment_id",
            timeout=15,
        )
        if not es_error:
            for row in es_rows or []:
                enr_id = row.get("enrollment_id")
                if enr_id and enr_id not in es_by_enrollment:
                    es_by_enrollment[enr_id] = row.get("id")

    students = []
    seen = set()
    for row in enr_rows or []:
        student = _normalize_student_record(row.get("students"))
        if not _is_active_student_record(student):
            continue
        student_key = (student.get("student_id") or "").strip().upper()
        if not student_key or student_key in seen:
            continue
        seen.add(student_key)
        enrollment_id = row.get("id")
        students.append({
            "enrollmentSubjectId": es_by_enrollment.get(enrollment_id),
            "enrollmentId": enrollment_id,
            "studentId": student.get("student_id") or "",
            "studentName": f"{student.get('last_name', '')}, {student.get('first_name', '')}".strip(", "),
        })

    students.sort(key=lambda item: item.get("studentName") or "")
    sem = schedule_row.get("semesters") or {}
    sy = sem.get("school_years") or {}
    sec = schedule_row.get("sections") or {}
    strand = sec.get("strands") or {}
    sub = schedule_row.get("subjects") or {}
    return {
        "meta": {
            "scheduleId": schedule_row.get("id"),
            "schoolYearLabel": sy.get("label") or "",
            "semesterName": sem.get("name") or "",
            "semesterCode": sem.get("code") or "",
            "gradeLevel": sec.get("grade_level") or "",
            "strandCode": strand.get("code") or "",
            "sectionName": sec.get("name") or "",
            "subjectCode": sub.get("code") or "",
            "subjectName": sub.get("name") or "",
        },
        "students": students,
    }


def save_grading_sheet_rest(faculty_id_text, schedule_id, rows):
    faculty_row, schedule_row = _verify_faculty_schedule(faculty_id_text, schedule_id)
    if not faculty_row or not schedule_row:
        return False, "Schedule not assigned to this faculty"

    semester_id = schedule_row.get("semester_id")
    allowed_es = set()
    es_rows, es_error = supabase_rest_get(
        "enrollment_subjects",
        f"class_schedule_id=eq.{schedule_id}&select=id,enrollments!inner(status,semester_id)",
        timeout=15,
    )
    if not es_error:
        for row in es_rows or []:
            enrollment = row.get("enrollments") or {}
            if enrollment.get("status") != "enrolled":
                continue
            if str(enrollment.get("semester_id") or "") != str(semester_id or ""):
                continue
            if row.get("id"):
                allowed_es.add(row["id"])

    saved = 0
    for item in rows or []:
        es_id = item.get("enrollmentSubjectId")
        if not es_id or es_id not in allowed_es:
            continue
        payload = {
            "enrollment_subject_id": es_id,
            "encoded_by": faculty_row["id"],
            "updated_at": datetime.utcnow().isoformat() + "Z",
        }
        for key in GRADING_SHEET_SCORE_KEYS:
            db_col = GRADING_SHEET_DB_COLUMNS[key]
            value = item.get(key)
            if value is None or value == "":
                payload[db_col] = None
            else:
                try:
                    payload[db_col] = float(value)
                except (TypeError, ValueError):
                    payload[db_col] = None

        existing, existing_error = supabase_rest_get(
            "grading_sheet_scores",
            f"enrollment_subject_id=eq.{es_id}&select=enrollment_subject_id&limit=1",
            timeout=15,
        )
        if existing_error:
            return False, parse_supabase_error(existing_error)

        if existing:
            _, patch_error = supabase_rest_patch(
                "grading_sheet_scores",
                f"enrollment_subject_id=eq.{es_id}",
                payload,
                timeout=15,
            )
            if patch_error:
                return False, parse_supabase_error(patch_error)
        else:
            _, post_error = supabase_rest_post("grading_sheet_scores", payload, timeout=15)
            if post_error:
                return False, parse_supabase_error(post_error)
        saved += 1

    return True, {"saved": saved}


def handle_get_grading_sheet_filters(handler):
    params = parse_query(handler)
    faculty_id = (params.get("facultyId") or "").strip().upper()
    if not faculty_id:
        json_response(handler, 400, {"success": False, "error": "facultyId required"})
        return
    if not supabase_configured():
        json_response(handler, 503, {"success": False, "error": "Supabase not configured"})
        return

    result, error = supabase_rpc("get_grading_sheet_filters", {"p_faculty_id": faculty_id}, timeout=15)
    if error:
        data = fetch_grading_sheet_filters_rest(faculty_id)
    else:
        data = result if isinstance(result, list) else parse_rpc_json_list(result)

    json_response(handler, 200, {"success": True, "data": data})


def handle_get_grading_sheet(handler):
    params = parse_query(handler)
    faculty_id = (params.get("facultyId") or "").strip().upper()
    schedule_id = (params.get("scheduleId") or "").strip()
    if not faculty_id or not schedule_id:
        json_response(handler, 400, {"success": False, "error": "facultyId and scheduleId required"})
        return
    if not supabase_configured():
        json_response(handler, 503, {"success": False, "error": "Supabase not configured"})
        return

    result, error = supabase_rpc("get_grading_sheet", {
        "p_faculty_id": faculty_id,
        "p_schedule_id": schedule_id,
    }, timeout=20)
    if error:
        data = fetch_grading_sheet_rest(faculty_id, schedule_id)
        if not data:
            json_response(handler, 500, {"success": False, "error": parse_supabase_error(error)})
            return
    else:
        data = result if isinstance(result, dict) else {}

    json_response(handler, 200, {"success": True, "data": data})


def handle_save_grading_sheet(handler):
    try:
        body = read_json_body(handler)
    except json.JSONDecodeError:
        json_response(handler, 400, {"success": False, "error": "Invalid request body"})
        return
    if not supabase_configured():
        json_response(handler, 503, {"success": False, "error": "Supabase not configured"})
        return

    faculty_id = (body.get("facultyId") or "").strip().upper()
    schedule_id = (body.get("scheduleId") or "").strip()
    rows = body.get("rows") or []
    if not faculty_id or not schedule_id:
        json_response(handler, 400, {"success": False, "error": "facultyId and scheduleId required"})
        return

    result, error = supabase_rpc("save_grading_sheet", {
        "p_faculty_id": faculty_id,
        "p_schedule_id": schedule_id,
        "p_rows": rows,
    }, timeout=25)
    if error:
        ok, rest_result = save_grading_sheet_rest(faculty_id, schedule_id, rows)
        if not ok:
            json_response(handler, 500, {"success": False, "error": rest_result})
            return
        json_response(handler, 200, {"success": True, "data": rest_result})
        return

    json_response(handler, 200, {"success": True, "data": result})


def _enrolled_count_for_schedule(row, enrollment_counts=None):
    schedule_id = row.get("id")
    computed = 0
    if enrollment_counts is not None and schedule_id:
        value = enrollment_counts.get(str(schedule_id))
        if value is None:
            value = enrollment_counts.get(schedule_id)
        computed = int(value or 0)
    db_count = int(row.get("enrolled_count") or 0)
    return max(computed, db_count)


def _total_students_from_schedule_rows(rows, enrollment_counts=None):
    section_peak = {}
    for row in rows or []:
        count = _enrolled_count_for_schedule(row, enrollment_counts)
        if count <= 0:
            continue
        section = (row.get("sections") or {}).get("name") or ""
        key = section or f"__schedule_{row.get('id')}"
        section_peak[key] = max(section_peak.get(key, 0), count)
    return sum(section_peak.values())


def format_teacher_schedule_row(row, enrollment_counts=None):
    subject = row.get("subjects") or {}
    section = row.get("sections") or {}
    room = row.get("rooms") or {}
    schedule_id = row.get("id")
    enrolled = _enrolled_count_for_schedule(row, enrollment_counts)
    section_name = section.get("name") or ""
    return {
        "id": schedule_id,
        "subjectCode": subject.get("code") or "",
        "subjectName": subject.get("name") or "",
        "section": section_name,
        "sectionName": section_display_name(section_name),
        "sectionGradeLevel": section.get("grade_level") or "",
        "subjectGradeLevel": subject.get("grade_level") or "",
        "room": room.get("name") or "TBA",
        "dayOfWeek": row.get("day_of_week") or "",
        "scheduleLabel": row.get("schedule_label") or "",
        "startTime": row.get("start_time") or "",
        "endTime": row.get("end_time") or "",
        "enrolledCount": enrolled,
        "maxSlots": row.get("max_slots") or 0,
    }


def attach_enrollment_counts(rows):
    schedule_ids = [row.get("id") for row in (rows or []) if row.get("id")]
    counts = fetch_schedule_enrollment_counts(schedule_ids, schedule_rows=rows)
    return [format_teacher_schedule_row(row, counts) for row in (rows or [])]


def handle_teacher_schedule(handler):
    params = parse_query(handler)
    faculty_id = (params.get("facultyId") or "").strip().upper()
    if not faculty_id:
        json_response(handler, 400, {"success": False, "error": "facultyId required"})
        return
    if not supabase_configured():
        json_response(handler, 503, {"success": False, "error": "Supabase not configured"})
        return

    faculty_row = resolve_faculty_uuid(faculty_id)
    if not faculty_row:
        json_response(handler, 404, {"success": False, "error": "Teacher not found"})
        return

    query = (
        f"faculty_id=eq.{faculty_row['id']}&is_active=eq.true"
        "&select=id,subject_id,section_id,schedule_label,day_of_week,start_time,end_time,enrolled_count,max_slots,"
        "subjects(code,name,grade_level),sections(name,grade_level),rooms(name)"
        "&order=day_of_week.asc,start_time.asc"
    )
    rows, error = supabase_rest_get("class_schedules", query)
    if error:
        json_response(handler, 500, {"success": False, "error": parse_supabase_error(error)})
        return

    data = attach_enrollment_counts(rows)
    json_response(handler, 200, {"success": True, "data": data})


def handle_teacher_dashboard(handler):
    params = parse_query(handler)
    faculty_id = (params.get("facultyId") or "").strip().upper()
    if not faculty_id:
        json_response(handler, 400, {"success": False, "error": "facultyId required"})
        return

    faculty_row = resolve_faculty_uuid(faculty_id) if supabase_configured() else None
    classes = []
    total_students = 0

    if faculty_row:
        rows = get_teacher_schedule_rows(faculty_row["id"])
        if rows:
            schedule_ids = [row.get("id") for row in rows if row.get("id")]
            stats = fetch_teacher_enrollment_stats_rpc(faculty_id) or {}
            if not stats.get("totalStudents"):
                stats = fetch_teacher_enrollment_stats(schedule_ids, schedule_rows=rows)
            counts = stats.get("classCounts") or {}
            total_students = int(stats.get("totalStudents") or 0)
            if not total_students:
                total_students = _total_students_from_schedule_rows(rows, counts)
            if not total_students:
                total_students = _count_students_in_teacher_sections(faculty_row["id"], get_current_semester_id())
            classes = [format_teacher_schedule_row(row, counts) for row in rows]
            sem_id = get_current_semester_id()
            section_totals = _section_enrollment_totals(faculty_row["id"], sem_id)
            if section_totals:
                for idx, row in enumerate(rows):
                    sec_id = str(row.get("section_id") or "")
                    sec_count = int(section_totals.get(sec_id) or 0)
                    if sec_count > 0 and idx < len(classes):
                        classes[idx]["enrolledCount"] = max(
                            int(classes[idx].get("enrolledCount") or 0),
                            sec_count,
                        )
            if not total_students:
                section_peak = {}
                for cls in classes:
                    count = int(cls.get("enrolledCount") or 0)
                    if count <= 0:
                        continue
                    section = cls.get("section") or str(cls.get("id") or "")
                    section_peak[section] = max(section_peak.get(section, 0), count)
                total_students = sum(section_peak.values())

    payload = {
        "teacherName": (
            f"{faculty_row.get('last_name', '')}, {faculty_row.get('first_name', '')}".strip(", ")
            if faculty_row
            else faculty_id
        ),
        "department": (faculty_row or {}).get("department") or "",
        "classCount": len(classes),
        "totalStudents": total_students,
        "classes": classes[:8],
        "schoolName": SCHOOL_NAME,
    }
    json_response(handler, 200, {"success": True, "data": payload})


def verify_supabase_connection():
    if not supabase_configured():
        return False, "Missing SUPABASE_URL or API key in .env"
    result, error = supabase_rpc("authenticate_faculty", {
        "p_faculty_id": "__ping__",
        "p_password": "__ping__",
    }, timeout=8)
    if error:
        lower = error.lower()
        if "invalid" in lower or "password" in lower or "credentials" in lower:
            return True, "Connected"
        if "function" in lower and "does not exist" in lower:
            return False, "Run supabase/schema.sql in Supabase SQL Editor"
        return False, parse_supabase_error(error)
    return True, "Connected"


def handle_health(handler):
    connected, message = verify_supabase_connection()
    json_response(handler, 200, {
        "success": True,
        "portal": "faculty",
        "supabaseConfigured": supabase_configured(),
        "supabaseConnected": connected,
        "supabaseMessage": message,
        "envSource": str(ENV_SOURCE) if ENV_SOURCE else None,
    })


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        super().end_headers()

    def do_GET(self):
        path = unquote(self.path.split("?", 1)[0])

        if path in ("/", "/index.html"):
            self.send_response(302)
            self.send_header("Location", "/login.html")
            self.end_headers()
            return

        if path == "/js/config.js" or path.endswith("/js/config.js"):
            content = build_config_js().encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/javascript; charset=utf-8")
            self.send_header("Content-Length", str(len(content)))
            self.end_headers()
            self.wfile.write(content)
            return

        if path == "/api/health":
            handle_health(self)
            return

        if path == "/api/grades/sections":
            handle_get_grades_sections(self)
            return

        if path == "/api/grades/students":
            handle_get_students_for_grading(self)
            return

        if path == "/api/grades/sheet":
            handle_get_grades_sheet(self)
            return

        if path == "/api/grading-sheet/filters":
            handle_get_grading_sheet_filters(self)
            return

        if path == "/api/grading-sheet/data":
            handle_get_grading_sheet(self)
            return

        if path == "/api/faculty/dashboard":
            handle_teacher_dashboard(self)
            return

        if path == "/api/faculty/schedule":
            handle_teacher_schedule(self)
            return

        return super().do_GET()

    def do_POST(self):
        path = unquote(self.path.split("?", 1)[0])

        if path == "/api/auth/faculty":
            handle_faculty_login(self)
            return

        if path == "/api/grades/save":
            handle_save_grades(self)
            return

        if path == "/api/grading-sheet/save":
            handle_save_grading_sheet(self)
            return

        self.send_error(404, "Not found")


def faculty_server_responding(port):
    try:
        with urlopen(f"http://127.0.0.1:{port}/api/health", timeout=2) as response:
            data = json.loads(response.read().decode("utf-8"))
            return data.get("portal") == "faculty"
    except Exception:
        return False


def port_in_use_error(exc):
    if getattr(exc, "winerror", None) == 10048:
        return True
    if getattr(exc, "errno", None) in (98, 48, 10048):
        return True
    return "already in use" in str(exc).lower() or "10048" in str(exc)


def find_port_owner_pid(port):
    try:
        output = subprocess.check_output(
            ["netstat", "-ano"],
            text=True,
            encoding="utf-8",
            errors="ignore",
        )
    except Exception:
        return None

    suffix = f":{port}"
    for line in output.splitlines():
        if "LISTENING" not in line or suffix not in line:
            continue
        parts = line.split()
        if len(parts) < 5:
            continue
        try:
            return int(parts[-1])
        except ValueError:
            continue
    return None


def port_blocked_by_other_portal(port):
    try:
        with urlopen(f"http://127.0.0.1:{port}/api/health", timeout=2) as response:
            data = json.loads(response.read().decode("utf-8"))
            return data.get("portal") != "faculty"
    except Exception:
        return False


def faculty_port_candidates(preferred, count=10):
    """Return ports to try; skip 8001 (admin) and 8002 (scheduler)."""
    reserved = {8001, 8002}
    ports = []
    port = preferred
    while len(ports) < count:
        if port not in reserved:
            ports.append(port)
        port += 1
    return ports


def print_faculty_banner(url, *, already_running=False, port_note=None):
    print("=" * 50)
    print("  Geranova EMS — FACULTY PORTAL (Teachers)")
    print("=" * 50)
    if port_note:
        print(f"\n  {port_note}")
    if already_running:
        print(f"\n  Faculty server is already running at: {url}")
    else:
        connected, sb_message = verify_supabase_connection()
        if supabase_configured():
            supabase_status = f"Connected ({sb_message})" if connected else f"Error — {sb_message}"
        else:
            supabase_status = "Not configured (.env missing URL or key)"
        env_note = f"  Env file:          {ENV_SOURCE}" if ENV_SOURCE else "  Env file:          not found (copy ENROLLSYSTEM-ADMIN/.env)"
        print(f"\n  Server running at: {url}")
        print(f"  Supabase:          {supabase_status}")
        print(env_note)
        print(f"  Faculty login:     {url}/login.html")
        print(f"  Admin (Registrar): {ADMIN_PORTAL_URL}/login.html")
        print("\n  --- TEACHER ACCOUNTS (sample) ---")
        print("  Teacher ID:  FAC-STEM-01")
        print("  Password:    teacher123")
        print("\n  Grades saved here appear on the student portal (port 8000).")
        print("\n  Run: python server.py")
        print("\n  Press Ctrl+C to stop the server.")
    print("\n" + "=" * 50)


def open_faculty_portal(url, open_path="/login.html"):
    if os.environ.get("EMS_NO_BROWSER"):
        return
    target = url.rstrip("/") + open_path

    def _open():
        try:
            webbrowser.open(target)
        except Exception:
            pass

    threading.Timer(0.8, _open).start()


def main():
    os.chdir(ROOT)
    preferred_port = int(os.environ.get("EMS_FACULTY_PORT", PORT))
    port_note = None
    httpd = None
    chosen_port = None

    class ThreadingHTTPServer(socketserver.ThreadingMixIn, socketserver.TCPServer):
        daemon_threads = True
        allow_reuse_address = False

    for port in faculty_port_candidates(preferred_port):
        try:
            httpd = ThreadingHTTPServer(("", port), Handler)
            chosen_port = port
            break
        except OSError as exc:
            if not port_in_use_error(exc):
                raise
            if faculty_server_responding(port):
                url = f"http://localhost:{port}"
                print_faculty_banner(url, already_running=True)
                open_faculty_portal(url, os.environ.get("EMS_OPEN_URL", "/login.html"))
                return
            if port_blocked_by_other_portal(port):
                owner = find_port_owner_pid(port)
                owner_text = f" (PID {owner})" if owner else ""
                raise RuntimeError(
                    f"Port {port} is used by the Admin server{owner_text}, not Faculty.\n"
                    f"  Stop the admin server (Ctrl+C in its terminal), then restart:\n"
                    f"  Admin on port 8001: python server.py (ENROLLSYSTEM-ADMIN)\n"
                    f"  Faculty here:       python server.py\n"
                    f"  (Admin must stay on 8001; Faculty uses 8003.)"
                )
            if port == preferred_port:
                owner = find_port_owner_pid(port)
                owner_text = f" (PID {owner})" if owner else ""
                port_note = (
                    f"Port {preferred_port} was blocked{owner_text}. "
                    f"Close the other terminal (Ctrl+C) and try again."
                )
            continue

    if httpd is None or chosen_port is None:
        raise RuntimeError(
            f"Could not start faculty server near port {preferred_port}.\n"
            f"  Close other terminals using that port, then run: python server.py"
        )

    if chosen_port != preferred_port and port_note:
        port_note = port_note.replace(
            "Trying the next available port.",
            f"Started on port {chosen_port} instead.",
        )

    url = f"http://localhost:{chosen_port}"
    print_faculty_banner(url, port_note=port_note)
    open_faculty_portal(url, os.environ.get("EMS_OPEN_URL", "/login.html"))
    httpd.serve_forever()


if __name__ == "__main__":
    main()
