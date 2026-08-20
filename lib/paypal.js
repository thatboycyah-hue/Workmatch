// PayPal API helpers for WorkMatch.
//
// This module is server-side only.
// It obtains a PayPal OAuth access token and provides helpers
// for retrieving PayPal orders.

const PAYPAL_ENV = process.env.PAYPAL_ENV || 'live';

const PAYPAL_API_BASE =
  PAYPAL_ENV === 'sandbox'
    ? 'https://api-m.sandbox.paypal.com'
    : 'https://api-m.paypal.com';

const PRODUCT_PRICE = '2.00';
const PRODUCT_CURRENCY = 'USD';

async function getAccessToken() {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error(
      'PAYPAL_CLIENT_ID or PAYPAL_CLIENT_SECRET is not configured'
    );
  }

  const credentials = Buffer.from(
    `${clientId}:${clientSecret}`
  ).toString('base64');

  const response = await fetch(
    `${PAYPAL_API_BASE}/v1/oauth2/token`,
    {
      method: 'POST',
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: 'grant_type=client_credentials'
    }
  );

  if (!response.ok) {
    const body = await response.text();

    throw new Error(
      `PayPal OAuth failed (${response.status}): ${body}`
    );
  }

  const data = await response.json();

  if (!data.access_token) {
    throw new Error('PayPal OAuth response did not contain an access token');
  }

  return data.access_token;
}

async function getOrder(orderId) {
  if (!orderId) {
    throw new Error('PayPal order ID is required');
  }

  const token = await getAccessToken();

  const response = await fetch(
    `${PAYPAL_API_BASE}/v2/checkout/orders/${encodeURIComponent(orderId)}`,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    }
  );

  if (!response.ok) {
    const body = await response.text();

    throw new Error(
      `PayPal get-order failed (${response.status}): ${body}`
    );
  }

  return response.json();
}

module.exports = {
  PAYPAL_API_BASE,
  PRODUCT_PRICE,
  PRODUCT_CURRENCY,
  getAccessToken,
  getOrder
};
