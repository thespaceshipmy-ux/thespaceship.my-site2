// POST /.netlify/functions/confirm-booking
// Admin-only (signed in + on the admins table). Confirms or declines a
// pending booking request from the admin page. The actual confirm/decline
// logic (update + emails + calendar invite) lives in lib.js and is shared
// with booking-action.js, which does the same thing from a one-click link
// in the notification email instead of requiring a login.
//
// Body: { booking_id, action: "confirm" | "decline" }
const { getServiceClient, getCallerUser, isAdminEmail, performBookingAction, json } = require('./lib/lib');

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

  const { booking_id, action } = body;
  if (!booking_id || !['confirm', 'decline'].includes(action)) {
    return json(400, { error: 'booking_id and action ("confirm" | "decline") are required' });
  }

  const result = await performBookingAction(supabase, booking_id, action);
  if (result.error) return json(result.statusCode || 500, { error: result.error });
  return json(200, { ok: true, status: result.status });
};
