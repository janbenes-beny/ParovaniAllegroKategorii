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

async function getCategoryById({ categoryId, storefront, locale, clientKey, secretKey }) {
  const url =
    `${KAUFLAND_BASE_URL}/categories/${encodeURIComponent(String(categoryId))}/?storefront=${encodeURIComponent(
      storefront
    )}&locale=${encodeURIComponent(locale)}`;
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

async function getChildCategories({ parentId, storefront, locale, clientKey, secretKey }) {
  // Kaufland API validates `limit` and rejects values above 100.
  // We paginate to avoid losing progress due to a hard limit.
  const limit = 100;
  let offset = 0;
  const all = [];

  while (true) {
    const url = `${KAUFLAND_BASE_URL}/categories/?id_parent=${encodeURIComponent(
      String(parentId)
    )}&storefront=${encodeURIComponent(storefront)}&locale=${encodeURIComponent(locale)}&limit=${limit}&offset=${offset}`;
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
  const locale = (body.locale || "cs-CZ").trim();
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
    // Preferred approach: one-shot fetch of the whole category tree.
    // On local `netlify dev` the BFS approach often hits the ~30s lambda-local timeout.
    try {
      const HARD_MAX_NEW_ITEMS = 200000;
      // For the one-shot tree endpoint we don't want to artificially truncate based on UI "batch" size.
      // We'll only cap to the same safety limit as the old BFS approach.
      const treeMaxNewItems = HARD_MAX_NEW_ITEMS;

      const treeUrl =
        `${KAUFLAND_BASE_URL}/categories/tree?` +
        `storefront=${encodeURIComponent(storefront)}` +
        `&locale=${encodeURIComponent(locale)}`;

      const treeRes = await kauflandSignedFetchJson({
        url: treeUrl,
        method: "GET",
        body: "",
        clientKey,
        secretKey,
      });

      if (treeRes && treeRes.ok && treeRes.json) {
        const treeJson = treeRes.json;
        const rootCandidate =
          treeJson && typeof treeJson === "object"
            ? treeJson.data != null
              ? treeJson.data
              : treeJson.tree != null
                ? treeJson.tree
                : treeJson.categories != null
                  ? treeJson.categories
                  : treeJson
            : treeJson;

        const rootNodes = Array.isArray(rootCandidate) ? rootCandidate : [rootCandidate];

        const items = [];
        const visited = new Set();

        const pickId = (node) => {
          if (!node || typeof node !== "object") return null;
          const raw = node.id_category != null ? node.id_category : node.id != null ? node.id : null;
          if (raw == null) return null;
          return String(raw);
        };

        const pickChildren = (node) => {
          if (!node || typeof node !== "object") return [];
          if (Array.isArray(node.children)) return node.children;
          if (Array.isArray(node.subcategories)) return node.subcategories;
          if (Array.isArray(node.child_categories)) return node.child_categories;

          // Fallback: try to find the first array property that looks like categories.
          const keys = Object.keys(node);
          for (const k of keys) {
            const v = node[k];
            if (!Array.isArray(v) || v.length === 0) continue;
            const looksLikeCategoryArray = v.every(
              (x) => x && typeof x === "object" && (x.id_category != null || x.id != null)
            );
            if (looksLikeCategoryArray) return v;
          }
          return [];
        };

        const pickTitle = (node, idStr) => {
          const chosen = chooseCategoryTitle(node);
          if (chosen && typeof chosen === "string" && chosen.trim()) return chosen.trim();
          const name = node && typeof node === "object" ? node.name : null;
          if (typeof name === "string" && name.trim()) return name.trim();
          return idStr;
        };

        const walk = (node, pathParts) => {
          if (!node) return;
          if (items.length >= treeMaxNewItems) return;

          const idStr = pickId(node);
          if (!idStr) return;
          if (visited.has(idStr)) return;

          const title = pickTitle(node, idStr);
          const nextParts = pathParts.concat([title]);

          items.push({
            id: idStr,
            path: nextParts.join("/"),
            name: title,
          });
          visited.add(idStr);

          const children = pickChildren(node);
          for (const child of children) {
            walk(child, nextParts);
            if (items.length >= treeMaxNewItems) break;
          }
        };

        for (const root of rootNodes) {
          walk(root, []);
          if (items.length >= treeMaxNewItems) break;
        }

        if (items.length) {
          return {
            statusCode: 200,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              newItems: items,
              truncated: treeMaxNewItems > 0 && items.length >= treeMaxNewItems,
              state: null,
            }),
          };
        }
      }
    } catch {
      // Fallback to BFS below.
    }

    const MAX_DURATION_MS = 25000; // keep safely below local lambda-local timeout
    const startedAt = Date.now();
    const deadline = startedAt + MAX_DURATION_MS;
    let timedOut = false;

    const HARD_MAX_NEW_ITEMS = 200000;
    const maxNewItems = Number.isNaN(requestedMaxNewItems)
      ? 100
      : Math.max(1, Math.min(requestedMaxNewItems, HARD_MAX_NEW_ITEMS));

    let visited = new Set();
    let queue = [];
    let newItems = [];

    if (!state) {
      const rootId = 1;
      const rootCategory = await getCategoryById({ categoryId: rootId, storefront, locale, clientKey, secretKey });
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
      if (Date.now() >= deadline) {
        timedOut = true;
        break;
      }

      const node = queue.shift();
      const nodeId = node.id;

      const children = await getChildCategories({
        parentId: nodeId,
        storefront,
        locale,
        clientKey,
        secretKey,
      });

      if (Date.now() >= deadline) {
        timedOut = true;
        break;
      }

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

        if (Date.now() >= deadline) {
          timedOut = true;
          break;
        }
      }

      if (timedOut) break;
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        newItems,
        truncated: timedOut || queue.length > 0,
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

