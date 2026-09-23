// POST /.netlify/functions/notify-new-booking
// Called by the member dashboard right after it inserts a new booking
// request. Emails the studio so Aiman knows a request is waiting in the
// admin page. This does NOT touch the calendar — that only happens once
// the request is confirmed (see confirm-booking.js).
//
// Body: { booking_id }
const { Resend } = require('resend');
const { getServiceClient, getCallerUser, json } = require('./lib/lib');

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
    .select('id, requested_date, requested_start_time, duration_hours, notes, member_id, members(full_name, email, phone, membership_type, user_id)')
    .eq('id', booking_id)
    .single();

  if (bookingError || !booking) return json(404, { error: 'Booking not found' });
  if (booking.members.user_id !== caller.id) return json(403, { error: 'Not your booking' });

  if (process.env.RESEND_API_KEY && process.env.ADMIN_NOTIFICATION_EMAIL && process.env.EMAIL_FROM) {
    const resend = new Resend(process.env.RESEND_API_KEY);
    try {
      await resend.emails.send({
        from: process.env.EMAIL_FROM,
        to: process.env.ADMIN_NOTIFICATION_EMAIL,
        subject: `New booking request — ${booking.members.full_name}`,
        text: [
          `${booking.members.full_name} (${booking.members.membership_type} member) requested a session.`,
          ``,
          `Date: ${booking.requested_date}`,
          `Time: ${booking.requested_start_time}`,
          `Duration: ${booking.duration_hours} hr(s)`,
          `Notes: ${booking.notes || '—'}`,
          `Contact: ${booking.members.email}${booking.members.phone ? ' / ' + booking.members.phone : ''}`,
          ``,
          `Review and confirm it in the admin page.`,
        ].join('\n'),
      });
    } catch (e) {
      // Don't fail the request over a flaky email send — the booking is
      // already saved and will show up next time the admin page is opened.
      console.error('notify-new-booking email failed', e);
    }
  }

  return json(200, { ok: true });
};
