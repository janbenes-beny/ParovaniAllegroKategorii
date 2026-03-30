const ALLEGRO_TOKEN_URL = "https://allegro.pl/auth/oauth/token";
const ALLEGRO_CATEGORIES_URL = "https://api.allegro.pl/sale/categories";

const MAX_DURATION_MS = 25000; // keep safely below typical lambda-local timeouts

function isNonEmptyString(x) {
  return typeof x === "string" && x.trim().length > 0;
}

function normalizeCategories(data) {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  if (Array.isArray(data.categories)) return data.categories;
  if (data.data && Array.isArray(data.data.categories)) return data.data.categories;
  if (data.data && Array.isArray(data.data)) return data.data;
  return [];
}

function pickCategoryId(cat) {
  if (!cat || typeof cat !== "object") return null;
  if (cat.id != null) return String(cat.id);
  if (cat.category_id != null) return String(cat.category_id);
  if (cat.categoryId != null) return String(cat.categoryId);
  return null;
}

function pickCategoryName(cat, fallbackId) {
  if (!cat || typeof cat !== "object") return String(fallbackId || "");
  const name = cat.name || cat.categoryName || cat.title;
  if (typeof name === "string" && name.trim()) return name.trim();
  return String(fallbackId || "");
}

async function fetchAccessToken({ clientKey, secretKey }) {
  // OAuth2 client_credentials via Basic auth
  const basic = Buffer.from(`${clientKey}:${secretKey}`).toString("base64");
  const res = await fetch(ALLEGRO_TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: "Basic " + basic,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ grant_type: "client_credentials" }).toString(),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Allegro token HTTP ${res.status}: ${text.slice(0, 400)}`);
  }

  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // ignore
  }

  const token = json && json.access_token ? String(json.access_token) : "";
  if (!token) throw new Error("Allegro token: missing access_token");
  return token;
}

async function fetchChildCategories({ token, parentId, acceptLanguage }) {
  // Allegro expects `parent.id` query parameter for subcategories traversal.
  const url = `${ALLEGRO_CATEGORIES_URL}?parent.id=${encodeURIComponent(String(parentId))}`;
  const res = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: "Bearer " + token,
      Accept: "application/vnd.allegro.public.v1+json",
      "Accept-Language": String(acceptLanguage || "cs-CZ"),
    },
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Allegro categories HTTP ${res.status}: ${text.slice(0, 400)}`);
  }

  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }

  return normalizeCategories(json);
}

function coerceLeaf(value) {
  if (value === true) return true;
  if (value === false) return false;
  const s = String(value == null ? "" : value).trim().toLowerCase();
  return s === "true" || s === "1" || s === "yes";
}

async function fetchRootCategories({ token, acceptLanguage }) {
  const res = await fetch(ALLEGRO_CATEGORIES_URL, {
    method: "GET",
    headers: {
      Authorization: "Bearer " + token,
      Accept: "application/vnd.allegro.public.v1+json",
      "Accept-Language": String(acceptLanguage || "cs-CZ"),
    },
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Allegro categories root HTTP ${res.status}: ${text.slice(0, 400)}`);
  }

  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }

  return normalizeCategories(json);
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

  const clientKey = String(body.clientKey || "").trim();
  const secretKey = String(body.secretKey || "").trim();
  const acceptLanguage = String(body.acceptLanguage || "cs-CZ").trim();
  const state = body.state && typeof body.state === "object" ? body.state : null;

  if (!isNonEmptyString(clientKey) || !isNonEmptyString(secretKey)) {
    return {
      statusCode: 400,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Chybi clientKey nebo secretKey" }),
    };
  }

  const startedAt = Date.now();
  const deadline = startedAt + MAX_DURATION_MS;

  try {
    const accessToken = await fetchAccessToken({ clientKey, secretKey });

    let queue = [];
    let visited = new Set();
    const newItems = [];

    if (!state) {
      const rootCategories = await fetchRootCategories({ token: accessToken, acceptLanguage });

      // Discover roots and start expansion from them.
      for (const cat of rootCategories) {
        const id = pickCategoryId(cat);
        if (!id || visited.has(id)) continue;

        const name = pickCategoryName(cat, id);
        const leaf = coerceLeaf(cat.leaf);
        const path = name; // main category path starts with its name

        visited.add(id);
        newItems.push({ id, name, path });
        if (!leaf) queue.push({ id, path, leaf });
      }
    } else {
      const visitedArr = Array.isArray(state.visited) ? state.visited : [];
      visited = new Set(visitedArr.map((x) => String(x)));

      queue = Array.isArray(state.queue) ? state.queue : [];
      queue = queue
        .filter((n) => n && n.id != null && typeof n.path === "string")
        .map((n) => ({
          id: String(n.id),
          path: String(n.path),
          leaf: coerceLeaf(n.leaf),
        }));
    }

    let timedOut = false;

    while (queue.length) {
      if (Date.now() >= deadline) {
        timedOut = true;
        break;
      }

      const node = queue.shift();
      const parentId = node.id;
      const parentPath = node.path || "";

      const children = await fetchChildCategories({ token: accessToken, parentId, acceptLanguage });

      if (Date.now() >= deadline) {
        timedOut = true;
        break;
      }

      for (const child of children) {
        const id = pickCategoryId(child);
        if (!id || visited.has(id)) continue;

        const name = pickCategoryName(child, id);
        const leaf = coerceLeaf(child.leaf);
        const path = parentPath ? `${parentPath}/${name}` : name;

        visited.add(id);
        newItems.push({ id, name, path });
        if (!leaf) queue.push({ id, path, leaf });

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
        truncated: timedOut,
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
        error: error && error.message ? error.message : String(error),
      }),
    };
  }
};

