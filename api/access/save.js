const { saveMatchedList } = require("../../lib/store.js");

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  try {
    const { orderId, matchedList } = req.body || {};

    if (!orderId) {
      return res.status(400).json({
        error: "orderId is required"
      });
    }

    if (!Array.isArray(matchedList)) {
      return res.status(400).json({
        error: "matchedList must be an array"
      });
    }

    const purchase = await saveMatchedList(
      orderId,
      matchedList
    );

    return res.status(200).json({
      ok: true,
      saved: true,
      orderId: purchase.paypalOrderId,
      matchedList: purchase.matchedList
    });

  } catch (error) {
    console.error("Save matched list error:", error);

    return res.status(500).json({
      error: "Unable to save matched jobs"
    });
  }
      }
