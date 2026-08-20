// Purchase storage, backed by Vercel Config Storage.
// Stores purchase records as JSON strings.

async function apiCall(method, endpoint, body = null) {
  const config = process.env.GLOBAL_CONFIG;

  if (!config) {
    throw new Error("GLOBAL_CONFIG environment variable is missing");
  }

  const separator = config.includes("?") ? "&" : "?";
  const url = `${config}${separator}token=${encodeURIComponent(
    config.split("token=")[1] || ""
  )}`;

  if (!config.includes("token=")) {
    throw new Error("GLOBAL_CONFIG does not contain a token");
  }

  const options = {
    method,
    headers: {
      "Content-Type": "application/json"
    }
  };

  if (body !== null) {
    options.body = JSON.stringify(body);
  }

  const res = await fetch(url.replace(
    /https?:\/\/[^?]+/,
    config.split("?")[0]
  ) + endpoint + `?token=${encodeURIComponent(config.split("token=")[1])}`, options);

  const text = await res.text();

  if (!res.ok) {
    throw new Error(
      `Config Storage API failed (${res.status}): ${text}`
    );
  }

  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(
      `Config Storage API returned invalid JSON: ${text}`
    );
  }
}

async function getPurchaseByOrderId(orderId) {
  if (!orderId) {
    throw new Error("PayPal order ID is required");
  }

  const key = `order_${orderId}`;

  const result = await apiCall(
    "GET",
    `/items/${encodeURIComponent(key)}`
  );

  if (!result || !result.value) {
    return null;
  }

  try {
    return JSON.parse(result.value);
  } catch {
    throw new Error(
      `Stored purchase for ${key} contains invalid JSON`
    );
  }
}

async function getLatestPurchaseByEmail(email) {
  if (!email) {
    throw new Error("Email is required");
  }

  const normalizedEmail = String(email).trim().toLowerCase();
  const key = `email_${normalizedEmail}`;

  const result = await apiCall(
    "GET",
    `/items/${encodeURIComponent(key)}`
  );

  if (!result || !result.value) {
    return null;
  }

  try {
    return JSON.parse(result.value);
  } catch {
    throw new Error(
      `Stored purchase for ${key} contains invalid JSON`
    );
  }
}

async function savePurchase(purchase) {
  if (!purchase || !purchase.paypalOrderId) {
    throw new Error("Purchase must contain paypalOrderId");
  }

  const orderKey = `order_${purchase.paypalOrderId}`;
  const purchaseJson = JSON.stringify(purchase);

  await apiCall(
    "PUT",
    `/items/${encodeURIComponent(orderKey)}`,
    {
      value: purchaseJson
    }
  );

  if (
    purchase.payerEmail &&
    purchase.paymentStatus === "COMPLETED"
  ) {
    const emailKey =
      `email_${String(purchase.payerEmail).trim().toLowerCase()}`;

    await apiCall(
      "PUT",
      `/items/${encodeURIComponent(emailKey)}`,
      {
        value: purchaseJson
      }
    );
  }

  return purchase;
}

async function saveMatchedList(orderId, matchedList) {
  const purchase = await getPurchaseByOrderId(orderId);

  if (!purchase) {
    throw new Error("Purchase not found");
  }

  purchase.matchedList = Array.isArray(matchedList)
    ? matchedList
    : [];

  await savePurchase(purchase);

  return purchase;
}

module.exports = {
  getPurchaseByOrderId,
  getLatestPurchaseByEmail,
  savePurchase,
  saveMatchedList
};
