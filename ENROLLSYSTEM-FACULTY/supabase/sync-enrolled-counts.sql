-- Sync class_schedules.enrolled_count from active student enrollments
-- Run in Supabase SQL Editor

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

-- Per-faculty student totals (all faculty accounts)
SELECT
  f.faculty_id,
  COUNT(DISTINCT st.student_id) AS active_students
FROM class_schedules cs
JOIN faculty f ON f.id = cs.faculty_id
JOIN enrollment_subjects es ON (
  es.class_schedule_id = cs.id
  OR es.subject_id = cs.subject_id
)
JOIN enrollments e ON e.id = es.enrollment_id
JOIN students st ON st.id = e.student_id
JOIN semesters sem ON sem.id = e.semester_id
WHERE sem.is_current = TRUE
  AND cs.is_active = TRUE
  AND e.status IN ('enrolled', 'pending', 'approved')
  AND COALESCE(es.status, 'enrolled') = 'enrolled'
  AND COALESCE(st.is_active, TRUE) = TRUE
  AND COALESCE(st.account_status, 'active') NOT IN ('inactive', 'frozen', 'deleted')
  AND (
    es.class_schedule_id = cs.id
    OR (es.class_schedule_id IS NULL AND cs.section_id = e.section_id)
  )
GROUP BY f.faculty_id
ORDER BY f.faculty_id;
