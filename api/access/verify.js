const crypto = require("crypto");

function verifyToken(token) {
  const secret = process.env.ACCESS_TOKEN_SECRET;

  if (!secret || !token) return null;

  try {
    const parts = token.split(".");

    if (parts.length !== 2) return null;

    const [encoded, signature] = parts;

    const expected = crypto
      .createHmac("sha256", secret)
      .update(encoded)
      .digest("hex");

    if (
      signature.length !== expected.length ||
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

    if (!payload.orderId) {
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
    /*
     * The frontend currently sends:
     * { accessToken: "..." }
     *
     * We also continue accepting:
     * Authorization: Bearer <token>
     *
     * This keeps the endpoint compatible with both forms.
     */
    const authHeader = req.headers.authorization || "";

    let token = "";

    if (authHeader.startsWith("Bearer ")) {
      token = authHeader.slice(7).trim();
    }

    if (!token && req.body && typeof req.body.accessToken === "string") {
      token = req.body.accessToken.trim();
    }

    if (!token) {
      return res.status(401).json({
        valid: false,
        error: "Access token required"
      });
    }

    const payload = verifyToken(token);

    if (!payload) {
      return res.status(401).json({
        valid: false,
        error: "Invalid or expired access token"
      });
    }

    return res.status(200).json({
      valid: true,
      orderId: payload.orderId,
      email: payload.email
    });

  } catch (error) {
    console.error("Verify access error:", error);

    return res.status(500).json({
      valid: false,
      error: "Unable to verify access"
    });
  }
      }
