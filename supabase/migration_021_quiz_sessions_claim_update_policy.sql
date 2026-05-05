-- Allow the official LINE bot Supabase client to mark quiz reports as claimed.
-- Without an UPDATE policy, RLS can turn the update into 0 affected rows.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'quiz_sessions'
      AND policyname = 'Allow quiz session claim update'
  ) THEN
    CREATE POLICY "Allow quiz session claim update"
      ON public.quiz_sessions
      FOR UPDATE
      TO anon
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;
