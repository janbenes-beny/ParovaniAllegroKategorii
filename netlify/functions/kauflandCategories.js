const crypto = require("crypto");

const KAUFLAND_BASE_URL = "https://sellerapi.kaufland.com/v2";
const USER_AGENT = "Inhouse_development";
const MIN_REQUEST_INTERVAL_MS = 12; // approx ~83 requests/sec, under the documented 111/sec cap
let lastRequestAt = 0;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function chooseCategoryTitle(category) {
  if (!category || typeof category !== "object") return "";
  const plural = category.title_plural;
  const singular = category.title_singular;
  const name = category.name;
  const value = typeof plural === "string" && plural.trim() ? plural : (typeof singular === "string" && singular.trim() ? singular : (typeof name === "string" ? name.trim() : ""));
  return value || "";
}

function signRequest(method, uri, body, timestamp, secretKey) {
  // Signature payload: METHOD \n URI \n BODY \n TIMESTAMP
  const payload = [String(method).toUpperCase(), uri, body || "", String(timestamp)].join("\n");
  return crypto.createHmac("sha256", secretKey).update(payload).digest("hex");
}

async function kauflandSignedFetchJson({ url, method, body, clientKey, secretKey }) {
  // Throttle outgoing requests to keep global rate within limits.
  const now = Date.now();
  const wait = MIN_REQUEST_INTERVAL_MS - (now - lastRequestAt);
  if (wait > 0) await sleep(wait);
  lastRequestAt = Date.now();

  const timestamp = Math.floor(Date.now() / 1000);
  const bodyString = body == null ? "" : body;

  const signature = signRequest(method, url, bodyString, timestamp, secretKey);
  const headers = {
    Accept: "application/json",
    "Shop-Client-Key": clientKey,
    "Shop-Timestamp": String(timestamp),
    "Shop-Signature": signature,
    "User-Agent": USER_AGENT,
  };

  const fetchOptions = {
    method: String(method).toUpperCase(),
    headers,
  };

  if (bodyString) {
    headers["Content-Type"] = "application/json";
    fetchOptions.body = bodyString;
  }

  const res = await fetch(url, fetchOptions);
  const text = await res.text();

  let json = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      // ignore - non-json body
    }
  }

  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      bodyText: text,
      bodyJson: json,
    };
  }

  return { ok: true, json: json || null };
}

function pickCategoryData(responseJson) {
  // API "Object" responses commonly wrap the entity in `data`.
  if (!responseJson) return responseJson;
  if (responseJson.data && typeof responseJson.data === "object") return responseJson.data;
  return responseJson;
}

async function getCategoryById({ categoryId, storefront, clientKey, secretKey }) {
  const url = `${KAUFLAND_BASE_URL}/categories/${encodeURIComponent(String(categoryId))}/?storefront=${encodeURIComponent(storefront)}`;
  const res = await kauflandSignedFetchJson({
    url,
    method: "GET",
    body: "",
    clientKey,
    secretKey,
  });
  if (!res.ok) throw new Error(`Kaufland getCategoryById failed: HTTP ${res.status}: ${res.bodyText || ""}`);
  const category = pickCategoryData(res.json);
  return category;
}

async function getChildCategories({ parentId, storefront, clientKey, secretKey }) {
  // Kaufland API validates `limit` and rejects values above 100.
  // We paginate to avoid losing progress due to a hard limit.
  const limit = 100;
  let offset = 0;
  const all = [];

  while (true) {
    const url = `${KAUFLAND_BASE_URL}/categories/?id_parent=${encodeURIComponent(String(parentId))}&storefront=${encodeURIComponent(storefront)}&limit=${limit}&offset=${offset}`;
    const res = await kauflandSignedFetchJson({
      url,
      method: "GET",
      body: "",
      clientKey,
      secretKey,
    });
    if (!res.ok) throw new Error(`Kaufland getChildCategories failed: HTTP ${res.status}: ${res.bodyText || ""}`);

    const json = res.json || {};
    const pageItems = Array.isArray(json.data) ? json.data : [];
    all.push(...pageItems);

    const pagination = json.pagination || {};
    const total = typeof pagination.total === "number" ? pagination.total : null;

    // Stop if we reached total items (pagination-based),
    // or if the server returned less than `limit` (last page heuristic).
    if (total != null && all.length >= total) break;
    if (pageItems.length === 0) break;
    if (pageItems.length < limit) break;

    offset += limit;
  }

  return all;
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
  const storefront = (body.storefront || "de").trim();
  const requestedMaxNewItems =
    body.batchSize != null
      ? parseInt(String(body.batchSize), 10)
      : body.maxCategories != null
        ? parseInt(String(body.maxCategories), 10)
        : 100;

  const state = body.state && typeof body.state === "object" ? body.state : null;

  if (!clientKey || !secretKey) {
    return {
      statusCode: 400,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Chybi clientKey nebo secretKey" }),
    };
  }

  try {
    const HARD_MAX_NEW_ITEMS = 200000;
    const maxNewItems = Number.isNaN(requestedMaxNewItems)
      ? 100
      : Math.max(1, Math.min(requestedMaxNewItems, HARD_MAX_NEW_ITEMS));

    let visited = new Set();
    let queue = [];
    let newItems = [];

    if (!state) {
      const rootId = 1;
      const rootCategory = await getCategoryById({ categoryId: rootId, storefront, clientKey, secretKey });
      const rootTitle = chooseCategoryTitle(rootCategory) || String(rootId);

      visited = new Set([String(rootId)]);
      queue = [{ id: String(rootId), path: rootTitle }];

      // First batch includes the root.
      newItems.push({
        id: String(rootId),
        path: rootTitle,
        name: rootTitle,
      });
    } else {
      const visitedArr = Array.isArray(state.visited) ? state.visited : [];
      visited = new Set(visitedArr.map((x) => String(x)));

      queue = Array.isArray(state.queue) ? state.queue : [];
      queue = queue
        .filter((n) => n && n.id != null && typeof n.path === "string")
        .map((n) => ({ id: String(n.id), path: String(n.path) }));
    }

    while (queue.length && newItems.length < maxNewItems) {
      const node = queue.shift();
      const nodeId = node.id;

      const children = await getChildCategories({
        parentId: nodeId,
        storefront,
        clientKey,
        secretKey,
      });

      for (const child of children) {
        const childIdRaw = child && child.id_category != null ? String(child.id_category) : "";
        if (!childIdRaw) continue;
        if (visited.has(childIdRaw)) continue;

        const title = chooseCategoryTitle(child) || childIdRaw;
        const childPath = node.path ? node.path + "/" + title : title;

        visited.add(childIdRaw);
        queue.push({ id: childIdRaw, path: childPath });

        newItems.push({
          id: childIdRaw,
          path: childPath,
          name: title,
        });

        if (newItems.length >= maxNewItems) break;
      }
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        newItems,
        truncated: queue.length > 0,
        state: {
          queue,
          visited: Array.from(visited),
        },
      }),
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        error: error && error.message ? error.message : "Chyba pri nacitani kategorii Kaufland",
      }),
    };
  }
};

