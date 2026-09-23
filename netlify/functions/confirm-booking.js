// POST /.netlify/functions/confirm-booking
// Admin-only. Confirms or declines a pending booking request.
// On confirm: emails thespaceshipmy@gmail.com and the member, with a
// calendar invite (.ics) attached to the studio's email — Gmail shows an
// "Add to Calendar" button right on that attachment, so adding it to
// thespaceshipmy@gmail.com's calendar is one click. (This avoids needing a
// Google Cloud project / service account / billing setup.)
// On decline: just marks it declined and emails the member.
//
// Body: { booking_id, action: "confirm" | "decline" }
const { Resend } = require('resend');
const { getServiceClient, getCallerUser, isAdminEmail, json } = require('./lib/lib');

const STUDIO_ADDRESS = '2-12C, Block F, Jalan Desa 1/3, Desa Aman Puri, 52100 Kepong, Kuala Lumpur';

function icsEscape(text) {
  return String(text || '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

function toICSDate(date) {
  return date.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
}

function buildICS(booking) {
  // requested_date + requested_start_time are wall-clock time in
  // Asia/Kuala_Lumpur (UTC+8, no DST) — attach the offset explicitly so
  // this parses correctly regardless of the server's own timezone.
  const start = new Date(`${booking.requested_date}T${booking.requested_start_time}+08:00`);
  const end = new Date(start.getTime() + Number(booking.duration_hours) * 60 * 60 * 1000);
  const now = new Date();

  const description = [
    `Member: ${booking.members.full_name} (${booking.members.membership_type})`,
    `Contact: ${booking.members.email}${booking.members.phone ? ' / ' + booking.members.phone : ''}`,
    booking.notes ? `Notes: ${booking.notes}` : null,
    ``,
    `Booked via the member portal.`,
  ].filter(Boolean).join('\n');

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//The Spaceship//Member Portal//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${booking.id}@thespaceship.my`,
    `DTSTAMP:${toICSDate(now)}`,
    `DTSTART:${toICSDate(start)}`,
    `DTEND:${toICSDate(end)}`,
    `SUMMARY:${icsEscape(`${booking.members.membership_type} session — ${booking.members.full_name}`)}`,
    `DESCRIPTION:${icsEscape(description)}`,
    `LOCATION:${icsEscape(STUDIO_ADDRESS)}`,
    'STATUS:CONFIRMED',
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.join('\r\n');
}

async function sendEmail({ to, subject, text, ics }) {
  if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM) return;
  const resend = new Resend(process.env.RESEND_API_KEY);
  const payload = { from: process.env.EMAIL_FROM, to, subject, text };
  if (ics) {
    payload.attachments = [
      {
        filename: 'session.ics',
        content: Buffer.from(ics).toString('base64'),
      },
    ];
  }
  try {
    await resend.emails.send(payload);
  } catch (e) {
    console.error('confirm-booking email failed', e);
  }
}

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

  const { data: booking, error: bookingError } = await supabase
    .from('bookings')
    .select('id, requested_date, requested_start_time, duration_hours, notes, status, members(full_name, email, phone, membership_type)')
    .eq('id', booking_id)
    .single();

  if (bookingError || !booking) return json(404, { error: 'Booking not found' });
  if (booking.status !== 'pending') return json(409, { error: `Booking is already ${booking.status}` });

  if (action === 'decline') {
    const { error: updateError } = await supabase
      .from('bookings')
      .update({ status: 'declined' })
      .eq('id', booking_id);
    if (updateError) return json(500, { error: updateError.message });

    await sendEmail({
      to: booking.members.email,
      subject: 'About your session request at The Spaceship',
      text: `Hi ${booking.members.full_name},\n\nUnfortunately we can't confirm your request for ${booking.requested_date} at ${booking.requested_start_time}. Reply to this email or reach us on WhatsApp to find another time.\n\n— The Spaceship`,
    });

    return json(200, { ok: true, status: 'declined' });
  }

  // action === 'confirm'
  const { error: updateError } = await supabase
    .from('bookings')
    .update({ status: 'confirmed' })
    .eq('id', booking_id);
  if (updateError) return json(500, { error: updateError.message });

  const when = `${booking.requested_date} at ${booking.requested_start_time} (${booking.duration_hours} hr)`;
  const ics = buildICS(booking);

  await sendEmail({
    to: process.env.ADMIN_NOTIFICATION_EMAIL,
    subject: `Booking confirmed — ${booking.members.full_name}`,
    text: `${booking.members.full_name} is booked for ${when}.\n\nOpen the attached invite and click "Add to Calendar" to put it on the studio calendar.`,
    ics,
  });

  await sendEmail({
    to: booking.members.email,
    subject: 'Your session at The Spaceship is confirmed',
    text: `Hi ${booking.members.full_name},\n\nYou're confirmed for ${when}.\n\nSee you then!\n— The Spaceship`,
    ics,
  });

  return json(200, { ok: true, status: 'confirmed' });
};
