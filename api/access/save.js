const crypto = require("crypto");
const {
  getPurchaseByOrderId,
  saveMatchedList
} = require("../../lib/store.js");

function verifyToken(token) {
  const secret = process.env.ACCESS_TOKEN_SECRET;

  if (!secret || !token) return null;

  try {
    const [encoded, signature] = token.split(".");

    if (!encoded || !signature) return null;

    const expected = crypto
      .createHmac("sha256", secret)
      .update(encoded)
      .digest("hex");

    if (
      !crypto.timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(expected)
      )
    ) {
      return null;
    }

    const payload = JSON.parse(
      Buffer.from(encoded, "base64url").toString()
    );

    if (payload.exp && Date.now() > payload.exp) {
      return null;
    }

    return payload;

  } catch (error) {
    console.error("Token verification failed:", error);
    return null;
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  try {
    const authHeader = req.headers.authorization || "";

    if (!authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        error: "Authorization required"
      });
    }

    const token = authHeader.slice(7);
    const payload = verifyToken(token);

    if (!payload || !payload.orderId) {
      return res.status(401).json({
        error: "Invalid or expired access token"
      });
    }

    const { matchedList } = req.body || {};

    if (!Array.isArray(matchedList)) {
      return res.status(400).json({
        error: "matchedList must be an array"
      });
    }

    const purchase = await getPurchaseByOrderId(
      payload.orderId
    );

    if (!purchase || purchase.paymentStatus !== "COMPLETED") {
      return res.status(403).json({
        error: "Valid completed purchase required"
      });
    }

    const updated = await saveMatchedList(
      payload.orderId,
      matchedList
    );

    return res.status(200).json({
      ok: true,
      saved: true,
      orderId: updated.paypalOrderId
    });

  } catch (error) {
    console.error("Save matched list error:", error);

    return res.status(500).json({
      error: "Unable to save matched jobs"
    });
  }
      }
