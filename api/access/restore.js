const {
  getLatestPurchaseByEmail
} = require("../../lib/store.js");

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

    const purchase = await getLatestPurchaseByEmail(
      email.trim().toLowerCase()
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

    return res.status(200).json({
      ok: true,
      access: true,
      email: purchase.payerEmail,
      orderId: purchase.paypalOrderId,
      matchedList: purchase.matchedList || []
    });

  } catch (error) {
    console.error("Restore access error:", error);

    return res.status(500).json({
      error: "Unable to restore access"
    });
  }
  }
