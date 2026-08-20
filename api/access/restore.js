const crypto = require("crypto");
const { getLatestPurchaseByEmail } = require("../../lib/store.js");

function createAccessToken(orderId, email) {
  const secret = process.env.ACCESS_TOKEN_SECRET;

  if (!secret) {
    throw new Error("ACCESS_TOKEN_SECRET is not configured");
  }

  const payload = {
    orderId,
    email,
    exp: Date.now() + 1000 * 60 * 60 * 24 * 30
  };

  const encoded = Buffer
    .from(JSON.stringify(payload))
    .toString("base64url");

  const signature = crypto
    .createHmac("sha256", secret)
    .update(encoded)
    .digest("hex");

  return `${encoded}.${signature}`;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  try {
    const { email } = req.body || {};

    if (!email || typeof email !== "string") {
      return res.status(400).json({
        error: "Email is required"
      });
    }

    const normalizedEmail = email.trim().toLowerCase();

    const purchase = await getLatestPurchaseByEmail(
      normalizedEmail
    );

    if (!purchase) {
      return res.status(404).json({
        error: "No completed purchase found for this email"
      });
    }

    if (purchase.paymentStatus !== "COMPLETED") {
      return res.status(403).json({
        error: "Purchase is not completed"
      });
    }

    const accessToken = createAccessToken(
      purchase.paypalOrderId,
      normalizedEmail
    );

    return res.status(200).json({
      success: true,
      accessToken,
      matchedList: purchase.matchedList || []
    });

  } catch (error) {
    console.error("Restore access error:", error);

    return res.status(500).json({
      error: "Unable to restore access"
    });
  }
}
