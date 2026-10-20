DROP POLICY IF EXISTS "own sets" ON public.workout_sets;
REVOKE INSERT, UPDATE, DELETE ON public.workout_sets FROM authenticated;
CREATE POLICY "own sets read" ON public.workout_sets FOR SELECT TO authenticated USING (auth.uid() = user_id);