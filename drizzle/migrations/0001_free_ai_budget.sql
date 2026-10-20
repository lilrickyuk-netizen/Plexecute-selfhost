CREATE TABLE public.ai_usage (
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  day date NOT NULL,
  input_tokens int NOT NULL DEFAULT 0,
  output_tokens int NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
);

GRANT ALL ON public.ai_usage TO service_role;

ALTER TABLE public.ai_usage ENABLE ROW LEVEL SECURITY;

-- Atomically check and reserve part of the Free daily AI budget (spec 5.2: 25,000 input + 5,000 output tokens per user-local day).
-- Returns TRUE when the reservation fits inside the budget, FALSE when the budget is already used up.
CREATE OR REPLACE FUNCTION public.reserve_ai_budget(_user_id uuid, _day date, _in int, _out int, _max_in int, _max_out int)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE cur_in int; cur_out int;
BEGIN
  INSERT INTO public.ai_usage (user_id, day) VALUES (_user_id, _day)
  ON CONFLICT (user_id, day) DO NOTHING;
  SELECT input_tokens, output_tokens INTO cur_in, cur_out FROM public.ai_usage WHERE user_id = _user_id AND day = _day FOR UPDATE;
  IF cur_in + _in > _max_in OR cur_out + _out > _max_out THEN
    RETURN FALSE;
  END IF;
  UPDATE public.ai_usage SET input_tokens = input_tokens + _in, output_tokens = output_tokens + _out WHERE user_id = _user_id AND day = _day;
  RETURN TRUE;
END;
$$;