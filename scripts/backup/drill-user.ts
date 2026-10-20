import { createClient } from "@supabase/supabase-js";
import { deleteAccountJob } from "/dev-server/src/lib/privacy.functions";
const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});
const [cmd, id] = process.argv.slice(2);
if (cmd === "create") {
  const { data, error } = await db.auth.admin.createUser({
    email: `drill${Date.now()}@example.com`,
    password: "Drill!2026xx",
    email_confirm: true,
    user_metadata: { date_of_birth: "1990-01-01" },
  });
  if (error) throw error;
  await db.from("goals").insert({
    user_id: data.user.id,
    title: "Drill goal",
    domain: "training",
    weekly_minutes: 60,
    session_minutes: 30,
    status: "active",
  });
  console.log(data.user.id);
} else {
  console.log(JSON.stringify(await deleteAccountJob(db, id, async () => {})));
}
