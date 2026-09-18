-- Faculty Grading Sheet — component scores per enrollment subject
-- Run in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS grading_sheet_scores (
  enrollment_subject_id UUID PRIMARY KEY REFERENCES enrollment_subjects(id) ON DELETE CASCADE,
  assignment NUMERIC(5,2),
  quiz NUMERIC(5,2),
  seatwork NUMERIC(5,2),
  activity NUMERIC(5,2),
  recitation NUMERIC(5,2),
  performance_activity NUMERIC(5,2),
  project NUMERIC(5,2),
  presentation NUMERIC(5,2),
  group_activity NUMERIC(5,2),
  laboratory_activity NUMERIC(5,2),
  reporting NUMERIC(5,2),
  midterm_exam NUMERIC(5,2),
  final_exam NUMERIC(5,2),
  attendance NUMERIC(5,2),
  participation NUMERIC(5,2),
  behavior_conduct NUMERIC(5,2),
  class_standing NUMERIC(5,2),
  encoded_by UUID REFERENCES faculty(id),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_grading_sheet_scores_updated
  ON grading_sheet_scores(updated_at DESC);

CREATE OR REPLACE FUNCTION get_grading_sheet_filters(p_faculty_id TEXT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_faculty UUID;
BEGIN
  SELECT id INTO v_faculty
  FROM faculty
  WHERE faculty_id = UPPER(TRIM(COALESCE(p_faculty_id, '')))
  LIMIT 1;

  IF v_faculty IS NULL THEN
    RETURN '[]'::json;
  END IF;

  RETURN (
    SELECT COALESCE(json_agg(row_to_json(t) ORDER BY t."schoolYearLabel" DESC, t."semesterCode", t."gradeLevel", t."strandCode", t."sectionName", t."subjectCode"), '[]'::json)
    FROM (
      SELECT
        cs.id AS "scheduleId",
        sy.id AS "schoolYearId",
        sy.label AS "schoolYearLabel",
        sem.id AS "semesterId",
        sem.name AS "semesterName",
        sem.code AS "semesterCode",
        sec.grade_level AS "gradeLevel",
        str.code AS "strandCode",
        sec.id AS "sectionId",
        sec.name AS "sectionName",
        sub.id AS "subjectId",
        sub.code AS "subjectCode",
        sub.name AS "subjectName"
      FROM class_schedules cs
      JOIN semesters sem ON sem.id = cs.semester_id
      JOIN school_years sy ON sy.id = sem.school_year_id
      JOIN sections sec ON sec.id = cs.section_id
      JOIN strands str ON str.id = sec.strand_id
      JOIN subjects sub ON sub.id = cs.subject_id
      WHERE cs.faculty_id = v_faculty
        AND cs.is_active = TRUE
    ) t
  );
END;
$$;

CREATE OR REPLACE FUNCTION get_grading_sheet(p_faculty_id TEXT, p_schedule_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_faculty UUID;
  v_semester UUID;
  v_meta JSON;
  v_rows JSON;
BEGIN
  SELECT id INTO v_faculty
  FROM faculty
  WHERE faculty_id = UPPER(TRIM(COALESCE(p_faculty_id, '')))
  LIMIT 1;

  IF v_faculty IS NULL THEN
    RAISE EXCEPTION 'Faculty not found';
  END IF;

  SELECT cs.semester_id INTO v_semester
  FROM class_schedules cs
  WHERE cs.id = p_schedule_id
    AND cs.faculty_id = v_faculty
    AND cs.is_active = TRUE
  LIMIT 1;

  IF v_semester IS NULL THEN
    RAISE EXCEPTION 'Schedule not assigned to this faculty';
  END IF;

  SELECT json_build_object(
    'scheduleId', cs.id,
    'schoolYearLabel', sy.label,
    'semesterName', sem.name,
    'semesterCode', sem.code,
    'gradeLevel', sec.grade_level,
    'strandCode', str.code,
    'sectionName', sec.name,
    'subjectCode', sub.code,
    'subjectName', sub.name
  ) INTO v_meta
  FROM class_schedules cs
  JOIN semesters sem ON sem.id = cs.semester_id
  JOIN school_years sy ON sy.id = sem.school_year_id
  JOIN sections sec ON sec.id = cs.section_id
  JOIN strands str ON str.id = sec.strand_id
  JOIN subjects sub ON sub.id = cs.subject_id
  WHERE cs.id = p_schedule_id;

  SELECT COALESCE(json_agg(row_to_json(t) ORDER BY t."studentName"), '[]'::json) INTO v_rows
  FROM (
    SELECT
      es.id AS "enrollmentSubjectId",
      e.id AS "enrollmentId",
      st.student_id AS "studentId",
      CONCAT(st.last_name, ', ', st.first_name) AS "studentName",
      gs.assignment,
      gs.quiz,
      gs.seatwork,
      gs.activity,
      gs.recitation,
      gs.performance_activity AS "performanceActivity",
      gs.project,
      gs.presentation,
      gs.group_activity AS "groupActivity",
      gs.laboratory_activity AS "laboratoryActivity",
      gs.reporting,
      gs.midterm_exam AS "midtermExam",
      gs.final_exam AS "finalExam",
      gs.attendance,
      gs.participation,
      gs.behavior_conduct AS "behaviorConduct",
      gs.class_standing AS "classStanding"
    FROM class_schedules cs
    JOIN enrollments e ON e.section_id = cs.section_id
      AND e.semester_id = cs.semester_id
      AND e.status = 'enrolled'
    JOIN students st ON st.id = e.student_id
    LEFT JOIN enrollment_subjects es ON es.enrollment_id = e.id
      AND es.subject_id = cs.subject_id
      AND COALESCE(es.status, 'enrolled') IN ('enrolled', 'completed')
    LEFT JOIN grading_sheet_scores gs ON gs.enrollment_subject_id = es.id
    WHERE cs.id = p_schedule_id
      AND COALESCE(st.is_active, TRUE) = TRUE
      AND COALESCE(st.account_status, 'active') NOT IN ('inactive', 'frozen', 'deleted')
  ) t;

  RETURN json_build_object('meta', v_meta, 'students', v_rows);
END;
$$;

CREATE OR REPLACE FUNCTION save_grading_sheet(
  p_faculty_id TEXT,
  p_schedule_id UUID,
  p_rows JSON
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_faculty UUID;
  v_semester UUID;
  v_item JSON;
  v_es_id UUID;
  v_allowed BOOLEAN;
BEGIN
  SELECT id INTO v_faculty
  FROM faculty
  WHERE faculty_id = UPPER(TRIM(COALESCE(p_faculty_id, '')))
  LIMIT 1;

  IF v_faculty IS NULL THEN
    RAISE EXCEPTION 'Faculty not found';
  END IF;

  SELECT cs.semester_id INTO v_semester
  FROM class_schedules cs
  WHERE cs.id = p_schedule_id
    AND cs.faculty_id = v_faculty
    AND cs.is_active = TRUE
  LIMIT 1;

  IF v_semester IS NULL THEN
    RAISE EXCEPTION 'Schedule not assigned to this faculty';
  END IF;

  FOR v_item IN SELECT * FROM json_array_elements(COALESCE(p_rows, '[]'::json))
  LOOP
    v_es_id := (v_item->>'enrollmentSubjectId')::UUID;

    SELECT EXISTS (
      SELECT 1
      FROM enrollment_subjects es
      JOIN enrollments e ON e.id = es.enrollment_id
      WHERE es.id = v_es_id
        AND es.class_schedule_id = p_schedule_id
        AND e.semester_id = v_semester
        AND e.status = 'enrolled'
    ) INTO v_allowed;

    IF NOT v_allowed THEN
      CONTINUE;
    END IF;

    INSERT INTO grading_sheet_scores (
      enrollment_subject_id,
      assignment, quiz, seatwork, activity, recitation,
      performance_activity, project, presentation, group_activity, laboratory_activity, reporting,
      midterm_exam, final_exam,
      attendance, participation, behavior_conduct, class_standing,
      encoded_by, updated_at
    )
    VALUES (
      v_es_id,
      NULLIF(v_item->>'assignment', '')::NUMERIC,
      NULLIF(v_item->>'quiz', '')::NUMERIC,
      NULLIF(v_item->>'seatwork', '')::NUMERIC,
      NULLIF(v_item->>'activity', '')::NUMERIC,
      NULLIF(v_item->>'recitation', '')::NUMERIC,
      NULLIF(v_item->>'performanceActivity', '')::NUMERIC,
      NULLIF(v_item->>'project', '')::NUMERIC,
      NULLIF(v_item->>'presentation', '')::NUMERIC,
      NULLIF(v_item->>'groupActivity', '')::NUMERIC,
      NULLIF(v_item->>'laboratoryActivity', '')::NUMERIC,
      NULLIF(v_item->>'reporting', '')::NUMERIC,
      NULLIF(v_item->>'midtermExam', '')::NUMERIC,
      NULLIF(v_item->>'finalExam', '')::NUMERIC,
      NULLIF(v_item->>'attendance', '')::NUMERIC,
      NULLIF(v_item->>'participation', '')::NUMERIC,
      NULLIF(v_item->>'behaviorConduct', '')::NUMERIC,
      NULLIF(v_item->>'classStanding', '')::NUMERIC,
      v_faculty,
      NOW()
    )
    ON CONFLICT (enrollment_subject_id) DO UPDATE SET
      assignment = EXCLUDED.assignment,
      quiz = EXCLUDED.quiz,
      seatwork = EXCLUDED.seatwork,
      activity = EXCLUDED.activity,
      recitation = EXCLUDED.recitation,
      performance_activity = EXCLUDED.performance_activity,
      project = EXCLUDED.project,
      presentation = EXCLUDED.presentation,
      group_activity = EXCLUDED.group_activity,
      laboratory_activity = EXCLUDED.laboratory_activity,
      reporting = EXCLUDED.reporting,
      midterm_exam = EXCLUDED.midterm_exam,
      final_exam = EXCLUDED.final_exam,
      attendance = EXCLUDED.attendance,
      participation = EXCLUDED.participation,
      behavior_conduct = EXCLUDED.behavior_conduct,
      class_standing = EXCLUDED.class_standing,
      encoded_by = EXCLUDED.encoded_by,
      updated_at = NOW();
  END LOOP;

  RETURN json_build_object('success', TRUE);
END;
$$;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE grading_sheet_scores TO service_role;
GRANT EXECUTE ON FUNCTION get_grading_sheet_filters(TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION get_grading_sheet(TEXT, UUID) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION save_grading_sheet(TEXT, UUID, JSON) TO anon, authenticated, service_role;
