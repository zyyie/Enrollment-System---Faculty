-- Faculty dashboard: count enrolled students per teacher schedule
-- Run in Supabase SQL Editor after sync-enrolled-counts.sql

CREATE OR REPLACE FUNCTION get_teacher_enrollment_stats(p_faculty_id TEXT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_faculty TEXT := UPPER(TRIM(COALESCE(p_faculty_id, '')));
  result JSON;
BEGIN
  IF v_faculty = '' THEN
    RETURN json_build_object('totalStudents', 0, 'classCounts', '{}'::JSON);
  END IF;

  SELECT json_build_object(
    'totalStudents', COALESCE((
      SELECT COUNT(DISTINCT st.student_id)
      FROM enrollment_subjects es
      JOIN enrollments e ON e.id = es.enrollment_id
      JOIN students st ON st.id = e.student_id
      JOIN class_schedules cs ON cs.faculty_id = (
        SELECT id FROM faculty WHERE faculty_id = v_faculty LIMIT 1
      )
      JOIN semesters sem ON sem.id = e.semester_id
      WHERE cs.is_active = TRUE
        AND cs.subject_id = es.subject_id
        AND (
          es.class_schedule_id = cs.id
          OR (es.class_schedule_id IS NULL AND cs.section_id = e.section_id)
        )
        AND sem.is_current = TRUE
        AND e.status IN ('enrolled', 'pending', 'approved')
        AND COALESCE(es.status, 'enrolled') = 'enrolled'
        AND COALESCE(st.is_active, TRUE) = TRUE
        AND COALESCE(st.account_status, 'active') NOT IN ('inactive', 'frozen', 'deleted')
        AND st.student_id IS NOT NULL
        AND TRIM(st.student_id) <> ''
    ), 0),
    'classCounts', COALESCE((
      SELECT json_object_agg(sub.class_schedule_id, sub.cnt)
      FROM (
        SELECT cs.id::TEXT AS class_schedule_id,
               COUNT(DISTINCT st.student_id) AS cnt
        FROM class_schedules cs
        JOIN faculty f ON f.id = cs.faculty_id
        JOIN enrollment_subjects es ON es.subject_id = cs.subject_id
        JOIN enrollments e ON e.id = es.enrollment_id
        JOIN students st ON st.id = e.student_id
        JOIN semesters sem ON sem.id = e.semester_id
        WHERE f.faculty_id = v_faculty
          AND cs.is_active = TRUE
          AND sem.is_current = TRUE
          AND e.status IN ('enrolled', 'pending', 'approved')
          AND COALESCE(es.status, 'enrolled') = 'enrolled'
          AND COALESCE(st.is_active, TRUE) = TRUE
          AND COALESCE(st.account_status, 'active') NOT IN ('inactive', 'frozen', 'deleted')
          AND st.student_id IS NOT NULL
          AND TRIM(st.student_id) <> ''
          AND (
            es.class_schedule_id = cs.id
            OR (es.class_schedule_id IS NULL AND cs.section_id = e.section_id)
          )
        GROUP BY cs.id
      ) sub
    ), '{}'::JSON)
  ) INTO result;

  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION get_teacher_enrollment_stats(TEXT) TO anon, authenticated, service_role;
