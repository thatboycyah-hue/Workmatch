export default function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const paypalClientId = process.env.PAYPAL_CLIENT_ID;

  if (!paypalClientId) {
    return res.status(500).json({
      error: 'PAYPAL_CLIENT_ID is not configured'
    });
  }

  return res.status(200).json({
    paypalClientId,
    currency: 'USD'
  });
}
