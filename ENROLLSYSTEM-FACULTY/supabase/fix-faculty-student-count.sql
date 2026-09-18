-- Fix faculty dashboard showing 0 students after enrollment approval.
-- Run entire script in Supabase SQL Editor.

-- 1) Normalize legacy status: subject-approved enrollments should read as enrolled
UPDATE enrollments e
SET
  status = 'enrolled',
  enrolled_at = COALESCE(e.enrolled_at, e.reviewed_at, NOW()),
  updated_at = NOW()
FROM semesters sem
WHERE e.semester_id = sem.id
  AND sem.is_current = TRUE
  AND e.status = 'approved';

-- 2) Backfill missing/wrong class_schedule_id on enrollment_subjects
UPDATE enrollment_subjects es
SET class_schedule_id = sub.schedule_id
FROM (
  SELECT
    es2.id AS enrollment_subject_id,
    (
      SELECT cs.id
      FROM class_schedules cs
      JOIN sections sec ON sec.id = cs.section_id
      JOIN enrollments e2 ON e2.id = es2.enrollment_id
      JOIN students st ON st.id = e2.student_id
      WHERE cs.subject_id = es2.subject_id
        AND cs.semester_id = e2.semester_id
        AND cs.is_active = TRUE
        AND sec.strand_id = st.strand_id
        AND sec.grade_level = st.grade_level
        AND (
          e2.section_id IS NULL
          OR cs.section_id = e2.section_id
        )
      ORDER BY
        CASE WHEN es2.class_schedule_id = cs.id THEN 0 ELSE 1 END,
        CASE WHEN e2.section_id IS NOT NULL AND cs.section_id = e2.section_id THEN 0 ELSE 1 END,
        cs.schedule_label
      LIMIT 1
    ) AS schedule_id
  FROM enrollment_subjects es2
  JOIN enrollments e ON e.id = es2.enrollment_id
  JOIN semesters sem ON sem.id = e.semester_id
  WHERE sem.is_current = TRUE
    AND e.status IN ('enrolled', 'pending', 'approved')
    AND COALESCE(es2.status, 'enrolled') = 'enrolled'
) sub
WHERE es.id = sub.enrollment_subject_id
  AND sub.schedule_id IS NOT NULL
  AND (es.class_schedule_id IS NULL OR es.class_schedule_id IS DISTINCT FROM sub.schedule_id);

-- 3) Sync enrolled_count on class_schedules (includes approved + enrolled)
UPDATE class_schedules cs
SET enrolled_count = COALESCE(sub.cnt, 0)
FROM (
  SELECT
    es.class_schedule_id,
    COUNT(DISTINCT st.student_id) AS cnt
  FROM enrollment_subjects es
  JOIN enrollments e ON e.id = es.enrollment_id
  JOIN students st ON st.id = e.student_id
  JOIN semesters sem ON sem.id = e.semester_id
  WHERE e.status IN ('enrolled', 'pending', 'approved')
    AND sem.is_current = TRUE
    AND COALESCE(es.status, 'enrolled') = 'enrolled'
    AND COALESCE(st.is_active, TRUE) = TRUE
    AND COALESCE(st.account_status, 'active') NOT IN ('inactive', 'frozen', 'deleted')
    AND es.class_schedule_id IS NOT NULL
  GROUP BY es.class_schedule_id
) sub
WHERE cs.id = sub.class_schedule_id;

UPDATE class_schedules cs
SET enrolled_count = 0
WHERE cs.id NOT IN (
  SELECT es.class_schedule_id
  FROM enrollment_subjects es
  JOIN enrollments e ON e.id = es.enrollment_id
  JOIN students st ON st.id = e.student_id
  JOIN semesters sem ON sem.id = e.semester_id
  WHERE e.status IN ('enrolled', 'pending', 'approved')
    AND sem.is_current = TRUE
    AND COALESCE(es.status, 'enrolled') = 'enrolled'
    AND COALESCE(st.is_active, TRUE) = TRUE
    AND COALESCE(st.account_status, 'active') NOT IN ('inactive', 'frozen', 'deleted')
    AND es.class_schedule_id IS NOT NULL
);

-- 4) Refresh faculty stats RPC (section + subject fallback)
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

-- 5) DIAGNOSTIC — change faculty id if needed
SELECT 'current_enrollments' AS check_name, e.status, COUNT(*) AS cnt
FROM enrollments e
JOIN semesters sem ON sem.id = e.semester_id
WHERE sem.is_current = TRUE
GROUP BY e.status
ORDER BY e.status;

SELECT
  f.faculty_id,
  st.student_id,
  e.status AS enrollment_status,
  sec.name AS section_name,
  sub.code AS subject_code,
  es.class_schedule_id IS NOT NULL AS has_schedule_link
FROM enrollment_subjects es
JOIN enrollments e ON e.id = es.enrollment_id
JOIN students st ON st.id = e.student_id
JOIN subjects sub ON sub.id = es.subject_id
LEFT JOIN sections sec ON sec.id = e.section_id
JOIN class_schedules cs ON cs.id = es.class_schedule_id
JOIN faculty f ON f.id = cs.faculty_id
JOIN semesters sem ON sem.id = e.semester_id
WHERE sem.is_current = TRUE
  AND e.status IN ('enrolled', 'pending', 'approved')
ORDER BY f.faculty_id, st.student_id, sub.code;

SELECT
  f.faculty_id,
  COUNT(DISTINCT st.student_id) AS active_students
FROM class_schedules cs
JOIN faculty f ON f.id = cs.faculty_id
JOIN enrollment_subjects es ON es.subject_id = cs.subject_id
JOIN enrollments e ON e.id = es.enrollment_id
JOIN students st ON st.id = e.student_id
JOIN semesters sem ON sem.id = e.semester_id
WHERE sem.is_current = TRUE
  AND cs.is_active = TRUE
  AND e.status IN ('enrolled', 'pending', 'approved')
  AND COALESCE(es.status, 'enrolled') = 'enrolled'
  AND (
    es.class_schedule_id = cs.id
    OR (es.class_schedule_id IS NULL AND cs.section_id = e.section_id)
  )
GROUP BY f.faculty_id
ORDER BY f.faculty_id;
