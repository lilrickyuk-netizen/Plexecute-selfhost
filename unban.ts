import { createClient } from "@supabase/supabase-js";
const admin = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});
const u = JSON.parse(await Bun.file("/tmp/browser/mission/users.json").text()).B.uid;
console.log(
  (await admin.auth.admin.updateUserById(u, { ban_duration: process.argv[2] })).error?.message ??
    "ok",
);
