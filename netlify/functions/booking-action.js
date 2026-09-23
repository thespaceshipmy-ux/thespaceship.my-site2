// GET /.netlify/functions/booking-action?id=<booking_id>&token=<action_token>&action=confirm|decline
// Lets the studio confirm or decline a booking request straight from the
// "New booking request" email — no need to sign into the admin page.
//
// Each booking gets a random action_token when it's created (see
// supabase/schema.sql). Only a link carrying that exact token can act on
// that one booking, and it stops working the moment the booking is no
// longer pending — clicking Confirm and then Decline (or double-clicking
// the same link) just shows an "already handled" page the second time,
// it never re-fires the emails.
const { getServiceClient, performBookingAction, json } = require('./lib/lib');

function page(title, message, ok) {
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
    body: `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex">
<title>${title} — The Spaceship</title>
<style>
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f2ede3;color:#12142b;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:24px;}
  .card{background:#fff;border:1.5px solid #12142b;border-radius:4px;padding:32px 28px;max-width:420px;text-align:center;}
  h1{font-size:20px;margin:0 0 12px;}
  p{margin:0;line-height:1.5;}
  .ok{color:#1a7a3c;}
  .err{color:#b3261e;}
  a{color:#12142b;}
</style>
</head>
<body><div class="card"><h1 class="${ok ? 'ok' : 'err'}">${title}</h1><p>${message}</p></div></body>
</html>`,
  };
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') return json(405, { error: 'Method not allowed' });

  const { id, token, action } = event.queryStringParameters || {};
  if (!id || !token || !['confirm', 'decline'].includes(action)) {
    return page('Invalid link', 'This link is missing some information. Please use the admin page instead.', false);
  }

  const supabase = getServiceClient();

  const { data: booking, error: lookupError } = await supabase
    .from('bookings')
    .select('id, status, action_token')
    .eq('id', id)
    .maybeSingle();

  if (lookupError || !booking) return page('Not found', "This booking couldn't be found.", false);
  if (booking.action_token !== token) return page('Invalid link', 'This link is not valid for this booking.', false);

  if (booking.status !== 'pending') {
    return page(
      `Already ${booking.status}`,
      `This request was already marked ${booking.status} — no changes were made.`,
      booking.status === 'confirmed'
    );
  }

  const result = await performBookingAction(supabase, id, action);
  if (result.error) return page('Something went wrong', result.error, false);

  return page(
    result.status === 'confirmed' ? 'Booking confirmed' : 'Booking declined',
    result.status === 'confirmed'
      ? 'The member has been emailed, and a calendar invite was sent to you — open it and click "Add to Calendar."'
      : 'The member has been notified.',
    true
  );
};
