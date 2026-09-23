// POST /.netlify/functions/delete-member
// Admin-only. Deletes a member's login (Supabase auth user) along with
// their members row — bookings tied to them go too, since both
// members.user_id -> auth.users and bookings.member_id -> members are
// "on delete cascade" in schema.sql. Used to remove test data and members
// who've left.
//
// Body: { member_id }
const { getServiceClient, getCallerUser, isAdminEmail, json } = require('./lib/lib');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  const supabase = getServiceClient();
  const caller = await getCallerUser(event, supabase);
  if (!caller) return json(401, { error: 'Not signed in' });
  if (!(await isAdminEmail(supabase, caller.email))) return json(403, { error: 'Admins only' });

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return json(400, { error: 'Invalid JSON body' });
  }

  const { member_id } = body;
  if (!member_id) return json(400, { error: 'member_id is required' });

  const { data: member, error: memberError } = await supabase
    .from('members')
    .select('id, user_id')
    .eq('id', member_id)
    .maybeSingle();

  if (memberError) return json(500, { error: memberError.message });
  if (!member) return json(404, { error: 'Member not found' });

  if (member.user_id) {
    // Deleting the auth user cascades to the members row (and any of their
    // bookings) automatically via the foreign keys in schema.sql.
    const { error: deleteError } = await supabase.auth.admin.deleteUser(member.user_id);
    if (deleteError) return json(500, { error: deleteError.message });
  } else {
    const { error: deleteError } = await supabase.from('members').delete().eq('id', member_id);
    if (deleteError) return json(500, { error: deleteError.message });
  }

  return json(200, { ok: true });
};
