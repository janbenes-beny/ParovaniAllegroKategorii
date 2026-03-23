const crypto = require("crypto");

const KAUFLAND_BASE_URL = "https://sellerapi.kaufland.com/v2";
const USER_AGENT = "Inhouse_development";
const MIN_REQUEST_INTERVAL_MS = 12; // keep global request rate below 111/s
let lastRequestAt = 0;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function signRequest(method, uri, bodyString, timestamp, secretKey) {
  const payload = [
    String(method).toUpperCase(),
    uri,
    bodyString || "",
    String(timestamp),
  ].join("\n");

  // For Kaufland signature, expected output is hex digest.
  return crypto.createHmac("sha256", secretKey).update(payload).digest("hex");
}

async function kauflandSignedFetchJson({ url, method, bodyString, clientKey, secretKey }) {
  const now = Date.now();
  const wait = MIN_REQUEST_INTERVAL_MS - (now - lastRequestAt);
  if (wait > 0) await sleep(wait);
  lastRequestAt = Date.now();

  const timestamp = Math.floor(Date.now() / 1000);
  const signature = signRequest(method, url, bodyString, timestamp, secretKey);

  const headers = {
    Accept: "application/json",
    "Shop-Client-Key": clientKey,
    "Shop-Timestamp": String(timestamp),
    "Shop-Signature": signature,
    "User-Agent": USER_AGENT,
    "Content-Type": "application/json",
  };

  const res = await fetch(url, {
    method: String(method).toUpperCase(),
    headers,
    body: bodyString,
  });

  const text = await res.text();
  let json = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      // ignore
    }
  }

  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      bodyText: text,
      bodyJson: json,
      debug: {
        url,
        timestamp,
        signature,
        bodyString,
      },
    };
  }

  return {
    ok: true,
    json: json || null,
    debug: {
      url,
      timestamp,
      signature,
      bodyString,
    },
  };
}

function pickTopCategory(data) {
  if (!data) return null;
  if (Array.isArray(data) && data.length > 0) return data[0];
  if (Array.isArray(data.categories) && data.categories.length > 0) return data.categories[0];
  if (Array.isArray(data.data) && data.data.length > 0) return data.data[0];
  if (Array.isArray(data.results) && data.results.length > 0) return data.results[0];
  return null;
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Method not allowed" }),
    };
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return {
      statusCode: 400,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Neplatny JSON" }),
    };
  }

  const clientKey = (body.clientKey || "").trim();
  const secretKey = (body.secretKey || "").trim();
  const storefront = (body.storefront || "cz").trim();
  const locale = (body.locale || "cs-CZ").trim();

  const product = body.product && typeof body.product === "object" ? body.product : {};
  const title = (product.title || "").trim();
  const description = (product.description || "").trim();
  const manufacturer = (product.manufacturer || "").trim();

  if (!clientKey || !secretKey) {
    return {
      statusCode: 400,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Chybi clientKey nebo secretKey" }),
    };
  }

  if (!title && !description) {
    return {
      statusCode: 400,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Chybi product title nebo description" }),
    };
  }

  // This is a provisional payload: we send the minimal product fields
  // we already have from BaseLinker (title + description).
  const decideBody = {
    item: {
      title: title || "—",
      description: description || "",
      manufacturer: manufacturer || "unknown",
    },
    price: 0,
  };

  const bodyString = JSON.stringify(decideBody);

  // Endpoint: POST /v2/categories/decide/
  const url =
    `${KAUFLAND_BASE_URL}/categories/decide/` +
    `?storefront=${encodeURIComponent(storefront)}` +
    `&locale=${encodeURIComponent(locale)}`;

  const res = await kauflandSignedFetchJson({
    url,
    method: "POST",
    bodyString,
    clientKey,
    secretKey,
  });

  const curlFromDebug = (debug) => {
    if (!debug || !debug.url || !debug.signature || !debug.timestamp) return null;
    const compactBody = String(debug.bodyString || "").replace(/\r?\n/g, " ");
    const escapedBody = compactBody.replace(/'/g, `'\"'\"'`);
    const clientKeyEscaped = String(clientKey || "").replace(/'/g, `'\"'\"'`);
    return (
      "curl -X 'POST' '" +
      debug.url +
      "' \\\n" +
      "  -H 'accept: application/json' \\\n" +
      "  -H 'Content-Type: application/json' \\\n" +
      "  -H 'shop-client-key: " +
      clientKeyEscaped +
      "' \\\n" +
      "  -H 'shop-signature: " +
      debug.signature +
      "' \\\n" +
      "  -H 'shop-timestamp: " +
      String(debug.timestamp) +
      "' \\\n" +
      "  -d '" +
      escapedBody +
      "'"
    );
  };

  if (!res.ok) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        error: "Kaufland decide failed",
        status: res.status,
        bodyText: res.bodyText ? res.bodyText.slice(0, 1000) : "",
        bodyJson: res.bodyJson || null,
        debug: res.debug || null,
        curl: curlFromDebug(res.debug || null),
      }),
    };
  }

  const topCategory = pickTopCategory(res.json);
  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      topCategory,
      raw: res.json,
      debug: res.debug || null,
      curl: curlFromDebug(res.debug || null),
    }),
  };
};

