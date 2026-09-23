// POST /.netlify/functions/notify-new-booking
// Called by the member dashboard right after it inserts a new booking
// request. Emails the studio so Aiman knows a request is waiting — with
// one-click Confirm / Decline links (handled by booking-action.js) so it
// can be actioned straight from the email, no admin-page login required.
// This does NOT touch the calendar — that only happens once the request
// is confirmed (see lib.js's performBookingAction).
//
// Body: { booking_id }
const { getServiceClient, getCallerUser, sendEmail, json } = require('./lib/lib');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  const supabase = getServiceClient();
  const caller = await getCallerUser(event, supabase);
  if (!caller) return json(401, { error: 'Not signed in' });

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return json(400, { error: 'Invalid JSON body' });
  }

  const { booking_id } = body;
  if (!booking_id) return json(400, { error: 'booking_id is required' });

  // Load the booking + member, and make sure it really belongs to the
  // person calling this (so a random signed-in user can't spam emails
  // about bookings that aren't theirs).
  const { data: booking, error: bookingError } = await supabase
    .from('bookings')
    .select('id, requested_date, requested_start_time, duration_hours, notes, member_id, action_token, members(full_name, email, phone, membership_type, user_id)')
    .eq('id', booking_id)
    .single();

  if (bookingError || !booking) return json(404, { error: 'Booking not found' });
  if (booking.members.user_id !== caller.id) return json(403, { error: 'Not your booking' });

  if (process.env.ADMIN_NOTIFICATION_EMAIL) {
    const portalUrl = process.env.PORTAL_URL || '';
    const confirmUrl = `${portalUrl}/.netlify/functions/booking-action?id=${booking.id}&token=${booking.action_token}&action=confirm`;
    const declineUrl = `${portalUrl}/.netlify/functions/booking-action?id=${booking.id}&token=${booking.action_token}&action=decline`;
    const contact = `${booking.members.email}${booking.members.phone ? ' / ' + booking.members.phone : ''}`;

    await sendEmail({
      to: process.env.ADMIN_NOTIFICATION_EMAIL,
      subject: `New booking request — ${booking.members.full_name}`,
      text: [
        `${booking.members.full_name} (${booking.members.membership_type} member) requested a session.`,
        ``,
        `Date: ${booking.requested_date}`,
        `Time: ${booking.requested_start_time}`,
        `Duration: ${booking.duration_hours} hr(s)`,
        `Notes: ${booking.notes || '—'}`,
        `Contact: ${contact}`,
        ``,
        `Confirm: ${confirmUrl}`,
        `Decline: ${declineUrl}`,
        ``,
        `(Or review it in the admin page.)`,
      ].join('\n'),
      html: [
        `<p>${booking.members.full_name} (${booking.members.membership_type} member) requested a session.</p>`,
        `<p>`,
        `Date: ${booking.requested_date}<br>`,
        `Time: ${booking.requested_start_time}<br>`,
        `Duration: ${booking.duration_hours} hr(s)<br>`,
        `Notes: ${booking.notes || '—'}<br>`,
        `Contact: ${contact}`,
        `</p>`,
        `<p>`,
        `<a href="${confirmUrl}" style="display:inline-block;padding:10px 20px;background:#12142b;color:#fff;text-decoration:none;border-radius:4px;margin-right:10px;">Confirm</a>`,
        `<a href="${declineUrl}" style="display:inline-block;padding:10px 20px;border:1px solid #12142b;color:#12142b;text-decoration:none;border-radius:4px;">Decline</a>`,
        `</p>`,
        portalUrl ? `<p>Or review it in the <a href="${portalUrl}/portal/admin.html">admin page</a>.</p>` : '',
      ].join(''),
    });
  }

  return json(200, { ok: true });
};
