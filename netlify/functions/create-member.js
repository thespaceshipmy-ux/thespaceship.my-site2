// POST /.netlify/functions/create-member
// Admin-only. Creates a Supabase auth user + members row for a new member,
// and emails them a Supabase-hosted "set your password" invite link.
//
// Body: { email, full_name, phone, membership_type, renewal_date }
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

  const { email, full_name, phone, membership_type, renewal_date } = body;
  if (!email || !full_name || !membership_type) {
    return json(400, { error: 'email, full_name and membership_type are required' });
  }

  // Create (or reuse) the auth user and send them an invite email with a
  // link to set their own password.
  const { data: invite, error: inviteError } = await supabase.auth.admin.inviteUserByEmail(email, {
    redirectTo: process.env.PORTAL_URL ? `${process.env.PORTAL_URL}/portal/login.html` : undefined,
  });

  if (inviteError && !String(inviteError.message || '').toLowerCase().includes('already been registered')) {
    return json(500, { error: `Could not create login for ${email}: ${inviteError.message}` });
  }

  let userId = invite?.user?.id;

  // If the user already existed, look them up instead.
  if (!userId) {
    const { data: existing, error: lookupError } = await supabase.auth.admin.listUsers();
    if (lookupError) return json(500, { error: lookupError.message });
    const match = existing.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (!match) return json(500, { error: 'Could not find or create that user' });
    userId = match.id;
  }

  const { data: member, error: memberError } = await supabase
    .from('members')
    .upsert(
      {
        user_id: userId,
        full_name,
        email,
        phone: phone || null,
        membership_type,
        renewal_date: renewal_date || null,
        status: 'active',
      },
      { onConflict: 'user_id' }
    )
    .select()
    .single();

  if (memberError) return json(500, { error: memberError.message });

  return json(200, { member });
};
