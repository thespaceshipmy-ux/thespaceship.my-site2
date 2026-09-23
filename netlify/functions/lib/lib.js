// Shared helpers used by the portal's serverless functions.
const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');

const STUDIO_ADDRESS = '2-12C, Block F, Jalan Desa 1/3, Desa Aman Puri, 52100 Kepong, Kuala Lumpur';

function getServiceClient() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

// Verifies the caller's Supabase access token (sent by the browser as
// "Authorization: Bearer <token>") and returns the authenticated user, or
// null if the token is missing/invalid.
async function getCallerUser(event, supabaseAdmin) {
  const authHeader = event.headers.authorization || event.headers.Authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice('Bearer '.length);
  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data?.user) return null;
  return data.user;
}

async function isAdminEmail(supabaseAdmin, email) {
  if (!email) return false;
  const { data, error } = await supabaseAdmin
    .from('admins')
    .select('email')
    .eq('email', email)
    .maybeSingle();
  if (error) return false;
  return !!data;
}

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

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

// Builds a calendar invite (not just an informational copy) — it lists the
// studio as ORGANIZER and the member as an ATTENDEE, so when either side
// adds it to Google Calendar, the event carries the guest over and offers
// the usual RSVP flow, instead of two disconnected personal copies.
function buildICS(booking) {
  // requested_date + requested_start_time are wall-clock time in
  // Asia/Kuala_Lumpur (UTC+8, no DST) — attach the offset explicitly so
  // this parses correctly regardless of the server's own timezone.
  const start = new Date(`${booking.requested_date}T${booking.requested_start_time}+08:00`);
  const end = new Date(start.getTime() + Number(booking.duration_hours) * 60 * 60 * 1000);
  const now = new Date();
  const organizerEmail = process.env.ADMIN_NOTIFICATION_EMAIL || process.env.EMAIL_FROM;

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
    'METHOD:REQUEST',
    'BEGIN:VEVENT',
    `UID:${booking.id}@thespaceship.my`,
    `SEQUENCE:0`,
    `DTSTAMP:${toICSDate(now)}`,
    `DTSTART:${toICSDate(start)}`,
    `DTEND:${toICSDate(end)}`,
    `SUMMARY:${icsEscape(`${booking.members.membership_type} session — ${booking.members.full_name}`)}`,
    `DESCRIPTION:${icsEscape(description)}`,
    `LOCATION:${icsEscape(STUDIO_ADDRESS)}`,
    organizerEmail ? `ORGANIZER;CN=The Spaceship:mailto:${organizerEmail}` : null,
    `ATTENDEE;CN=${icsEscape(booking.members.full_name)};ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:${booking.members.email}`,
    'STATUS:CONFIRMED',
    'END:VEVENT',
    'END:VCALENDAR',
  ].filter(Boolean);
  return lines.join('\r\n');
}

async function sendEmail({ to, subject, text, html, ics }) {
  if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM) return;
  const resend = new Resend(process.env.RESEND_API_KEY);
  const payload = { from: process.env.EMAIL_FROM, to, subject, text };
  if (html) payload.html = html;
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
    console.error('sendEmail failed', e);
  }
}

// Shared by confirm-booking.js (admin page, signed-in) and
// booking-action.js (one-click link from the notification email). Does
// the actual confirm/decline: updates the row and sends the follow-up
// emails. Callers are responsible for checking who's allowed to call this
// (a valid session + admin check, or a valid action_token) before
// invoking it.
async function performBookingAction(supabase, bookingId, action) {
  const { data: booking, error: bookingError } = await supabase
    .from('bookings')
    .select('id, requested_date, requested_start_time, duration_hours, notes, status, members(full_name, email, phone, membership_type)')
    .eq('id', bookingId)
    .single();

  if (bookingError || !booking) return { error: 'Booking not found', statusCode: 404 };
  if (booking.status !== 'pending') {
    return { error: `Booking is already ${booking.status}`, statusCode: 409, status: booking.status };
  }

  if (action === 'decline') {
    const { error: updateError } = await supabase
      .from('bookings')
      .update({ status: 'declined' })
      .eq('id', bookingId);
    if (updateError) return { error: updateError.message, statusCode: 500 };

    await sendEmail({
      to: booking.members.email,
      subject: 'About your session request at The Spaceship',
      text: `Hi ${booking.members.full_name},\n\nUnfortunately we can't confirm your request for ${booking.requested_date} at ${booking.requested_start_time}. Reply to this email or reach us on WhatsApp to find another time.\n\n— The Spaceship`,
    });

    return { ok: true, status: 'declined', booking };
  }

  // action === 'confirm'
  const { error: updateError } = await supabase
    .from('bookings')
    .update({ status: 'confirmed' })
    .eq('id', bookingId);
  if (updateError) return { error: updateError.message, statusCode: 500 };

  const when = `${booking.requested_date} at ${booking.requested_start_time} (${booking.duration_hours} hr)`;
  const ics = buildICS(booking);

  await sendEmail({
    to: process.env.ADMIN_NOTIFICATION_EMAIL,
    subject: `Booking confirmed — ${booking.members.full_name}`,
    text: `${booking.members.full_name} is booked for ${when}.\n\nOpen the attached invite and click "Add to Calendar" to put it on the studio calendar and invite ${booking.members.full_name} automatically.`,
    ics,
  });

  await sendEmail({
    to: booking.members.email,
    subject: 'Your session at The Spaceship is confirmed',
    text: `Hi ${booking.members.full_name},\n\nYou're confirmed for ${when}.\n\nSee you then!\n— The Spaceship`,
    ics,
  });

  return { ok: true, status: 'confirmed', booking };
}

module.exports = {
  getServiceClient,
  getCallerUser,
  isAdminEmail,
  json,
  icsEscape,
  toICSDate,
  buildICS,
  sendEmail,
  performBookingAction,
  STUDIO_ADDRESS,
};
