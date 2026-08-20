// Purchase storage, backed by Vercel Config Storage.
// Stores purchase records as JSON strings.

async function apiCall(method, endpoint, body = null) {
  const token = process.env.GLOBAL_CONFIG?.split('token=')[1];
  const baseUrl = process.env.GLOBAL_CONFIG?.split('?')[0];
  
  if (!baseUrl || !token) {
    throw new Error('GLOBAL_CONFIG environment variable is not set correctly');
  }

  const url = `${baseUrl}${endpoint}?token=${token}`;
  const options = {
    method,
    headers: { 'Content-Type': 'application/json' }
  };
  
  if (body) {
    options.body = JSON.stringify(body);
  }

  const res = await fetch(url, options);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Config Storage API failed (${res.status}): ${text}`);
  }
  return res.json();
}

async function getPurchaseByOrderId(orderId) {
  try {
    const key = `order_${orderId}`;
    const result = await apiCall('GET', `/items/${key}`);
    if (!result || !result.value) return null;
    return JSON.parse(result.value);
  } catch (e) {
    console.error('getPurchaseByOrderId failed:', e);
    return null;
  }
}

async function getLatestPurchaseByEmail(email) {
  try {
    const key = `email_${String(email).trim().toLowerCase()}`;
    const result = await apiCall('GET', `/items/${key}`);
    if (!result || !result.value) return null;
    return JSON.parse(result.value);
  } catch (e) {
    console.error('getLatestPurchaseByEmail failed:', e);
    return null;
  }
}

async function savePurchase(purchase) {
  try {
    const orderKey = `order_${purchase.paypalOrderId}`;
    const purchaseJson = JSON.stringify(purchase);
    
    // Store by order ID
    await apiCall('PUT', `/items/${orderKey}`, {
      value: purchaseJson
    });

    // Only index by email once the purchase is actually confirmed completed
    if (purchase.payerEmail && purchase.paymentStatus === 'COMPLETED') {
      const emailKey = `email_${String(purchase.payerEmail).trim().toLowerCase()}`;
      await apiCall('PUT', `/items/${emailKey}`, {
        value: purchaseJson
      });
    }
  } catch (e) {
    console.error('savePurchase failed:', e);
    throw e;
  }
}

module.exports = { getPurchaseByOrderId, getLatestPurchaseByEmail, savePurchase };
