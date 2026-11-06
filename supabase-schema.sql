-- Supabase SQL Editor에서 최초 1회 실행합니다.
-- 이미 public.tasks 테이블이 있다면 이름/구조를 검토하고 실행하세요.
-- 공용 보드: 익명 및 로그인 사용자 모두 조회/생성/수정/삭제 가능.
-- 개인 보드: auth.uid()가 owner_id인 로그인 사용자만 접근 가능.
BEGIN;

CREATE TABLE public.tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 120),
  "desc" text NOT NULL DEFAULT '' CHECK (char_length("desc") <= 2000),
  status text NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'doing', 'done')),
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('high', 'normal', 'low')),
  due date,
  scope text NOT NULL DEFAULT 'public' CHECK (scope IN ('public', 'private')),
  owner_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tasks_owner_scope CHECK (
    (scope = 'public' AND owner_id IS NULL)
    OR (scope = 'private' AND owner_id IS NOT NULL)
  )
);
CREATE INDEX tasks_board_order_idx ON public.tasks(scope, owner_id, created_at, id);
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;

-- 테이블 기본 권한을 명시적으로 좁힙니다.
REVOKE ALL ON TABLE public.tasks FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT SELECT, DELETE ON TABLE public.tasks TO anon, authenticated;
GRANT INSERT (title, "desc", status, priority, due, scope, owner_id)
  ON TABLE public.tasks TO anon, authenticated;
-- ID, 생성시각, 보드 종류 및 소유자 변경은 클라이언트에 허용하지 않습니다.
GRANT UPDATE (title, "desc", status, priority, due)
  ON TABLE public.tasks TO anon, authenticated;

CREATE POLICY tasks_read ON public.tasks FOR SELECT TO anon, authenticated
USING (
  (scope = 'public' AND owner_id IS NULL)
  OR (scope = 'private' AND owner_id = (SELECT auth.uid()))
);
CREATE POLICY tasks_create ON public.tasks FOR INSERT TO anon, authenticated
WITH CHECK (
  (scope = 'public' AND owner_id IS NULL)
  OR (scope = 'private' AND owner_id = (SELECT auth.uid()))
);
CREATE POLICY tasks_update ON public.tasks FOR UPDATE TO anon, authenticated
USING (
  (scope = 'public' AND owner_id IS NULL)
  OR (scope = 'private' AND owner_id = (SELECT auth.uid()))
)
WITH CHECK (
  (scope = 'public' AND owner_id IS NULL)
  OR (scope = 'private' AND owner_id = (SELECT auth.uid()))
);
CREATE POLICY tasks_delete ON public.tasks FOR DELETE TO anon, authenticated
USING (
  (scope = 'public' AND owner_id IS NULL)
  OR (scope = 'private' AND owner_id = (SELECT auth.uid()))
);
COMMIT;
