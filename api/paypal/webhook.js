// POST /api/paypal/webhook
//
// This is the only thing that actually unlocks WorkMatch. The Hosted
// Button on the frontend gives the browser no completion signal, so
// verification happens entirely here, server-side, on real PayPal events:
//
//   1. Verify the request really came from PayPal (signature check against
//      PAYPAL_WEBHOOK_ID) — never trust an unverified POST to this URL.
//   2. Only act on PAYMENT.CAPTURE.COMPLETED.
//   3. Confirm the captured amount is exactly $2.00 USD — defense in depth,
//      in case the PayPal-side button config is ever changed or misused.
//   4. Resolve the order ID (via supplementary_data or by fetching the
//      capture details if that's missing).
//   5. Fetch the full order to reliably get the payer's email — capture
//      webhook payloads don't always include it.
//   6. Store the purchase, indexed by payer email — that's what
//      /api/access/restore looks purchases up by to mint a token.
//
// Configure this URL (https://yourdomain.com/api/paypal/webhook) in the
// PayPal Developer Dashboard under your Live app → Webhooks, subscribed at
// minimum to PAYMENT.CAPTURE.COMPLETED. PayPal gives you a Webhook ID when
// you do this — set it as PAYPAL_WEBHOOK_ID.
const crypto = require('crypto');
const { getAccessToken, getOrder, PAYPAL_API_BASE, PRODUCT_PRICE, PRODUCT_CURRENCY } = require('../../lib/paypal');
const { getPurchaseByOrderId, savePurchase } = require('../../lib/store');

async function verifySignature(req) {
  if (!process.env.PAYPAL_WEBHOOK_ID) {
    throw new Error('PAYPAL_WEBHOOK_ID is not set');
  }
  const token = await getAccessToken();
  const res = await fetch(`${PAYPAL_API_BASE}/v1/notifications/verify-webhook-signature`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      auth_algo: req.headers['paypal-auth-algo'],
      cert_url: req.headers['paypal-cert-url'],
      transmission_id: req.headers['paypal-transmission-id'],
      transmission_sig: req.headers['paypal-transmission-sig'],
      transmission_time: req.headers['paypal-transmission-time'],
      webhook_id: process.env.PAYPAL_WEBHOOK_ID,
      webhook_event: req.body
    })
  });
  if (!res.ok) return false;
  const data = await res.json();
  return data.verification_status === 'SUCCESS';
}

// Fetch the capture details to extract the order ID from the links array.
// Used as a fallback when supplementary_data.related_ids.order_id is missing.
async function resolveOrderIdFromCapture(captureId) {
  const token = await getAccessToken();
  const res = await fetch(
    `${PAYPAL_API_BASE}/v2/payments/captures/${encodeURIComponent(captureId)}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`PayPal get-capture failed (${res.status}): ${body}`);
  }
  const capture = await res.json();
  // The links array contains a rel="up" link to the parent order.
  const orderLink = (capture.links || []).find(link => link.rel === 'up');
  if (!orderLink || !orderLink.href) {
    throw new Error('Capture response had no order link in links array');
  }
  // Extract order ID from URL like https://api.paypal.com/v2/checkout/orders/12ABC...
  const match = orderLink.href.match(/\/orders\/([^/?]+)/);
  if (!match || !match[1]) {
    throw new Error('Could not extract order ID from capture link');
  }
  return match[1];
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  let verified = false;
  try {
    verified = await verifySignature(req);
  } catch (e) {
    console.error('Webhook signature verification errored:', e);
  }
  if (!verified) {
    // Do NOT process the event if verification failed or couldn't run.
    // A 400 here also tells PayPal's dashboard something's misconfigured
    // (e.g. PAYPAL_WEBHOOK_ID not set) rather than silently no-op'ing.
    console.error('Rejected webhook: signature verification failed');
    return res.status(400).json({ error: 'Signature verification failed' });
  }

  const event = req.body || {};
  if (event.event_type !== 'PAYMENT.CAPTURE.COMPLETED') {
    // Acknowledge anything we don't act on so PayPal doesn't keep retrying it.
    return res.status(200).json({ received: true });
  }

  try {
    const captureResource = event.resource || {};
    const captureId = captureResource.id;

    const amountOk =
      captureResource.amount?.value === PRODUCT_PRICE &&
      captureResource.amount?.currency_code === PRODUCT_CURRENCY;

    // Try to resolve order ID from supplementary_data first (ideal case),
    // fall back to fetching the capture details if it's missing.
    let orderId = captureResource.supplementary_data?.related_ids?.order_id;
    if (!orderId) {
      try {
        orderId = await resolveOrderIdFromCapture(captureId);
        console.log(`Resolved orderId from capture: ${captureId} → ${orderId}`);
      } catch (e) {
        console.error(`Could not resolve order ID from capture ${captureId}:`, e);
        // Return 500 for this transient error so PayPal retries.
        return res.status(500).json({ error: 'Could not resolve order ID' });
      }
    }

    // Idempotency: if this order is already recorded as COMPLETED, don't
    // re-fetch/re-store — just acknowledge.
    const existing = await getPurchaseByOrderId(orderId);
    if (existing && existing.paymentStatus === 'COMPLETED') {
      return res.status(200).json({ received: true });
    }

    // Capture payloads don't reliably include payer info — fetch the order
    // itself, which does.
    let payerEmail = null;
    try {
      const order = await getOrder(orderId);
      payerEmail = order?.payer?.email_address || null;
    } catch (e) {
      console.error(`Could not fetch order ${orderId} to resolve payer email:`, e);
      // Return 500 so PayPal retries — missing email is critical for restore to work.
      return res.status(500).json({ error: 'Could not fetch order for payer email' });
    }

    const now = new Date().toISOString();
    const purchaseId = existing?.purchaseId || crypto.randomUUID();
    const verified = amountOk && captureResource.status === 'COMPLETED';

    await savePurchase({
      purchaseId,
      paypalOrderId: orderId,
      paypalCaptureId: captureId,
      amount: captureResource.amount?.value || null,
      currency: captureResource.amount?.currency_code || null,
      payerEmail,
      paymentStatus: verified ? 'COMPLETED' : (captureResource.status || 'UNKNOWN'),
      unlockStatus: verified ? 'unlocked' : 'locked',
      createdAt: existing?.createdAt || now,
      updatedAt: now
    });

    if (!verified) {
      console.error('Webhook capture did not verify as a valid $2 USD completed payment:', {
        orderId, status: captureResource.status, amount: captureResource.amount
      });
    } else if (!payerEmail) {
      // Purchase is recorded and marked unlocked, but without an email it
      // can't be found by /api/access/restore. Worth alerting on in real
      // operation — logged here since there's no ops/alerting in this repo.
      console.error(`Order ${orderId} completed but no payer email resolved — buyer won't be able to self-unlock via email.`);
    } else {
      console.log(`Purchase recorded: orderId=${orderId}, email=${payerEmail}, status=COMPLETED`);
    }

    res.status(200).json({ received: true });
  } catch (e) {
    console.error('Webhook processing failed:', e);
    // Return 500 for transient errors so PayPal retries. Only return 200 for
    // truly permanent failures (signature verification, wrong event type, etc.)
    // Permanent failures are handled earlier in this function.
    res.status(500).json({ error: 'Internal error during webhook processing' });
  }
};
