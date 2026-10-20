DROP POLICY IF EXISTS "own food" ON public.food_entries;
REVOKE INSERT, UPDATE ON public.food_entries FROM authenticated;
CREATE POLICY "own food read" ON public.food_entries FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own food delete" ON public.food_entries FOR DELETE TO authenticated USING (auth.uid() = user_id);