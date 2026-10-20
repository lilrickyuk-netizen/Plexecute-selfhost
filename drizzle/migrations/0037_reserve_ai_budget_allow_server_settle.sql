CREATE OR REPLACE FUNCTION public.reserve_ai_budget(_user_id uuid, _day date, _in int, _out int, _max_in int, _max_out int)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE cur_in int; cur_out int;
BEGIN
  -- Only the server (service role) may call this; negative deltas settle over-estimates but never drop below zero.
  IF _user_id IS NULL OR _in IS NULL OR _out IS NULL THEN
    RETURN FALSE;
  END IF;
  INSERT INTO public.ai_usage (user_id, day) VALUES (_user_id, _day)
  ON CONFLICT (user_id, day) DO NOTHING;
  SELECT input_tokens, output_tokens INTO cur_in, cur_out FROM public.ai_usage WHERE user_id = _user_id AND day = _day FOR UPDATE;
  IF cur_in + _in > _max_in OR cur_out + _out > _max_out THEN
    RETURN FALSE;
  END IF;
  UPDATE public.ai_usage SET input_tokens = GREATEST(0, input_tokens + _in), output_tokens = GREATEST(0, output_tokens + _out) WHERE user_id = _user_id AND day = _day;
  RETURN TRUE;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.reserve_ai_budget(uuid, date, int, int, int, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_ai_budget(uuid, date, int, int, int, int) TO service_role;