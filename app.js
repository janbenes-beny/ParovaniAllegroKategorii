(function () {
  const TOKEN_STORAGE = "bl_token_local";
  const INVENTORY_STORAGE = "bl_inventory_local";
  const BASELINKER_INVENTORY_ID = 5257;
  const MAX_PRODUCTS_TO_SHOW = 50;

  const btnLoad = document.getElementById("btnLoad");
  const msgEl = document.getElementById("msg");
  const tableWrap = document.getElementById("tableWrap");
  const tbody = document.getElementById("productsTbody");
  const tokenInput = document.getElementById("apiToken");
  const inventoryInput = document.getElementById("inventoryId");
  const baseLinkerStatus = document.getElementById("baseLinkerStatus");
  const kauflandDecideTestModal = document.getElementById("kauflandDecideTestModal");
  const kauflandDecideTestOutput = document.getElementById("kauflandDecideTestOutput");
  const btnCloseKauflandDecideTestModal = document.getElementById("btnCloseKauflandDecideTestModal");
  const aiApiKeyInput = document.getElementById("aiApiKey");
  const aiProviderSelect = document.getElementById("aiProvider");
  const aiModelSelect = document.getElementById("aiModel");

  const btnOpenBaseLinkerLogin = document.getElementById("btnOpenBaseLinkerLogin");
  const baseLinkerLoginModal = document.getElementById("baseLinkerLoginModal");
  const btnLoginBaseLinker = document.getElementById("btnLoginBaseLinker");
  const btnCancelBaseLinkerLogin = document.getElementById("btnCancelBaseLinkerLogin");
  const loginMsgEl = document.getElementById("loginMsg");

  function showLoginMsg(text, type) {
    if (!loginMsgEl) return;
    loginMsgEl.textContent = text || "";
    loginMsgEl.className = "msg " + (type || "");
    loginMsgEl.classList.toggle("hidden", !text);
  }

  function showMsg(text, type) {
    msgEl.textContent = text || "";
    msgEl.className = "msg " + (type || "");
    msgEl.classList.toggle("hidden", !text);
  }

  function getToken() {
    const saved = sessionStorage.getItem(TOKEN_STORAGE) || "";
    return String(saved).trim();
  }

  function getInventoryId() {
    // hardcoded inventory id (hidden input in UI is just a fallback)
    return parseInt(String(BASELINKER_INVENTORY_ID), 10);
  }

  function apiUrl(path) {
    return "/.netlify/functions/" + path.replace(/^\//, "");
  }

  async function callBaseLinker(method, parameters) {
    const token = getToken();
    if (!token) {
      throw new Error("Zadejte API token.");
    }
    const response = await fetch(apiUrl("baselinker"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: token,
        method: method,
        parameters: parameters || {},
      }),
    });

    if (!response.ok) {
      const raw = await response.text();
      throw new Error("HTTP " + response.status + ": " + raw.slice(0, 200));
    }

    const data = await response.json();
    if (data.status !== "SUCCESS") {
      throw new Error((data.error_message || data.error || "Chyba BaseLinker API") + (data.error_code ? " (kód: " + data.error_code + ")" : ""));
    }
    return data;
  }

  function getDescriptionFromTextFields(textFields) {
    if (!textFields || typeof textFields !== "object") return "";
    const keys = [
      "description|cs|kauflandcz_0",
      "description|cs|kaufland_14257",
      "description|cs",
      "description",
    ];
    for (const key of keys) {
      const value = textFields[key];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
    return "";
  }

  function escapeHtml(value) {
    const div = document.createElement("div");
    div.textContent = value == null ? "" : String(value);
    return div.innerHTML;
  }

  function stripHtml(html) {
    if (!html) return "";
    const parser = new DOMParser();
    const doc = parser.parseFromString("<div>" + html + "</div>", "text/html");
    return (doc.body.textContent || "").trim();
  }

  function getMainImage(product) {
    if (!product || typeof product !== "object") return null;
    if (typeof product.image === "string" && product.image.trim()) {
      return product.image.trim();
    }
    if (product.image && typeof product.image === "object") {
      const imageKeys = Object.keys(product.image);
      for (const key of imageKeys) {
        const value = product.image[key];
        if (typeof value === "string" && value.trim()) return value.trim();
        if (value && typeof value === "object") {
          if (typeof value.url === "string" && value.url.trim()) return value.url.trim();
          if (typeof value.src === "string" && value.src.trim()) return value.src.trim();
        }
      }
    }
    if (Array.isArray(product.images) && product.images.length > 0) {
      const first = product.images[0];
      if (typeof first === "string") return first;
      if (first && typeof first.url === "string") return first.url;
      if (first && typeof first.src === "string") return first.src;
    }
    if (product.images && typeof product.images === "object") {
      const imageKeys = Object.keys(product.images);
      for (const key of imageKeys) {
        const value = product.images[key];
        if (typeof value === "string" && value.trim()) return value.trim();
        if (value && typeof value === "object") {
          if (typeof value.url === "string" && value.url.trim()) return value.url.trim();
          if (typeof value.src === "string" && value.src.trim()) return value.src.trim();
        }
      }
    }
    return null;
  }

  function mapCategories(categoriesResult) {
    const map = new Map();
    if (!categoriesResult) return map;
    if (Array.isArray(categoriesResult)) {
      categoriesResult.forEach((category) => {
        if (!category || typeof category !== "object") return;
        const categoryId = category.category_id != null ? String(category.category_id) : "";
        const name = category.name || category.category_name || category.title || "";
        if (categoryId) map.set(categoryId, name || categoryId);
      });
      return map;
    }

    Object.keys(categoriesResult).forEach((id) => {
      const category = categoriesResult[id];
      if (!category || typeof category !== "object") return;
      const categoryId = category.category_id != null ? String(category.category_id) : String(id);
      const name = category.name || category.category_name || category.title || "";
      map.set(categoryId, name || categoryId);
    });
    return map;
  }

  async function fetchAllProductIds(inventoryId, maxProducts) {
    const ids = [];
    let page = 1;
    const apiPageSize = 1000;
    const maxCount = Number.isNaN(parseInt(String(maxProducts), 10)) ? MAX_PRODUCTS_TO_SHOW : parseInt(String(maxProducts), 10);

    while (true) {
      const listData = await callBaseLinker("getInventoryProductsList", {
        inventory_id: inventoryId,
        page: page,
      });
      const products = listData.products || {};
      const keys = Object.keys(products);
      if (!keys.length) break;

      keys.forEach((id) => {
        const product = products[id];
        if (!product || typeof product !== "object") return;
        // Bereme pouze hlavní produkt, ne varianty.
        if (product.parent_id === 0 || product.parent_id == null) {
          ids.push(String(product.id || id));
        }
      });

      if (ids.length >= maxCount) break;

      if (keys.length < apiPageSize) break;
      page += 1;
    }

    return ids.slice(0, maxCount);
  }

  async function fetchProductsDataByIds(inventoryId, ids) {
    const allProducts = {};
    const batchSize = 1000;

    for (let start = 0; start < ids.length; start += batchSize) {
      const chunk = ids.slice(start, start + batchSize).map((id) => parseInt(id, 10)).filter((n) => !Number.isNaN(n));
      if (!chunk.length) continue;
      const data = await callBaseLinker("getInventoryProductsData", {
        inventory_id: inventoryId,
        products: chunk,
      });
      const products = data.products || {};
      Object.keys(products).forEach((id) => {
        allProducts[id] = products[id];
      });
    }

    return allProducts;
  }

  let kauflandProductsById = new Map();

  function renderRows(rows) {
    tbody.innerHTML = "";

    rows.forEach((row) => {
      const tr = document.createElement("tr");
      tr.innerHTML =
        "<td>" + escapeHtml(row.id) + "</td>" +
        "<td>" + escapeHtml(row.name || "—") + "</td>" +
        "<td>" + escapeHtml(row.heurekaCategoryId || "—") + "</td>" +
        "<td>" + escapeHtml(row.heurekaCategoryName || "—") + "</td>" +
        '<td class="image-col"></td>' +
        '<td><div class="desc">' + escapeHtml(row.description || "—") + "</div></td>" +
        '<td>' +
        '<button type="button" class="btnAiMatchCategory" data-product-id="' + escapeHtml(row.id) + '">AI odhad kategorie</button>' +
        '<div class="aiResult desc" style="margin-top: 6px;">—</div>' +
        "</td>" +
        '<td class="aiResultId">—</td>';

      const imageCell = tr.querySelector(".image-col");
      if (row.imageUrl) {
        const thumb = document.createElement("img");
        thumb.src = row.imageUrl;
        thumb.alt = "Obrazek produktu";
        thumb.className = "image-thumb";

        const linkWrap = document.createElement("div");
        const link = document.createElement("a");
        link.href = row.imageUrl;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = "Zobrazit obrázek";
        linkWrap.appendChild(link);

        imageCell.appendChild(thumb);
        imageCell.appendChild(linkWrap);
      } else {
        imageCell.textContent = "—";
      }

      tbody.appendChild(tr);
    });
  }

  async function loadProducts() {
    const inventoryId = getInventoryId();
    if (!inventoryId || Number.isNaN(inventoryId)) {
      showMsg("Zadejte platné Inventory ID.", "error");
      return;
    }
    if (!getToken()) {
      showMsg("Zadejte API token.", "error");
      return;
    }

    btnLoad.disabled = true;
    showMsg("Načítám data z BaseLinker...", "info");
    tableWrap.classList.add("hidden");

    try {
      const productIds = await fetchAllProductIds(inventoryId, MAX_PRODUCTS_TO_SHOW);
      const products = await fetchProductsDataByIds(inventoryId, productIds);
      let categoryMap = new Map();
      try {
        const categoriesData = await callBaseLinker("getInventoryCategories", { inventory_id: inventoryId });
        categoryMap = mapCategories(categoriesData.categories || categoriesData);
      } catch (categoryError) {
        // Pokud categories endpoint není dostupný, zobrazíme aspoň ID kategorie.
        categoryMap = new Map();
      }
      const rows = [];

      Object.keys(products).forEach((productId) => {
        const product = products[productId];
        if (!product || typeof product !== "object") return;

        const textFields = product.text_fields || {};
        const productName = textFields.name || textFields["name|cs"] || product.name || "";
        const descriptionHtml = getDescriptionFromTextFields(textFields);
        const description = stripHtml(descriptionHtml);
        const manufacturer =
          (typeof textFields.manufacturer === "string" && textFields.manufacturer.trim()
            ? textFields.manufacturer.trim()
            : typeof textFields["manufacturer|cs"] === "string" && textFields["manufacturer|cs"].trim()
              ? textFields["manufacturer|cs"].trim()
              : typeof textFields["brand"] === "string" && textFields.brand.trim()
                ? textFields.brand.trim()
                : typeof textFields["producer"] === "string" && textFields.producer.trim()
                  ? textFields.producer.trim()
                  : product.manufacturer && typeof product.manufacturer === "string" ? product.manufacturer.trim() : "") || "";
        const categoryId = product.category_id != null ? String(product.category_id) : "";
        const heurekaCategoryName = categoryMap.get(categoryId) || "—";
        const imageUrl = getMainImage(product);

        rows.push({
          id: String(product.id || productId),
          name: productName || "—",
          heurekaCategoryId: categoryId || "—",
          heurekaCategoryName: heurekaCategoryName || "—",
          imageUrl: imageUrl,
          description: description || "—",
          manufacturer: manufacturer || "",
        });
      });

      renderRows(rows);
      kauflandProductsById = new Map(rows.map((r) => [String(r.id), r]));
      tableWrap.classList.remove("hidden");
      showMsg("Načteno " + rows.length + " produktů.", "success");
    } catch (error) {
      showMsg("Chyba: " + (error.message || String(error)), "error");
    } finally {
      btnLoad.disabled = false;
    }
  }

  btnLoad.addEventListener("click", loadProducts);

  function escapePreText(text) {
    return String(text == null ? "" : text);
  }

  function openDecideTestModal(text) {
    if (!kauflandDecideTestModal || !kauflandDecideTestOutput) return;
    kauflandDecideTestOutput.textContent = escapePreText(text);
    kauflandDecideTestModal.classList.remove("hidden");
  }

  if (btnCloseKauflandDecideTestModal) {
    btnCloseKauflandDecideTestModal.addEventListener("click", function () {
      if (kauflandDecideTestModal) kauflandDecideTestModal.classList.add("hidden");
    });
  }

  async function testKauflandDecideCategoryForProduct(product, btnEl) {
    const clientKey = getKauflandClientKey();
    const secretKey = getKauflandSecretKey();
    const storefront = getKauflandStorefront();
    const locale = getKauflandLocale();

    if (!clientKey || !secretKey) {
      showMsg("Nejdřív zadej Kaufland client key a secret key (vpravo nahoře).", "error");
      return;
    }

    if (!product) return;

    const title = product.name || "";
    const description = product.description || "";
    const manufacturer = product.manufacturer || "";

    if (btnEl) btnEl.disabled = true;
    openDecideTestModal("Odesílám POST /categories/decide... čekám na odpověď.");

    try {
      const response = await fetch(apiUrl("kauflandDecideCategory"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientKey: clientKey,
          secretKey: secretKey,
          storefront: storefront,
          locale: locale,
          product: {
            title: title,
            description: description,
            manufacturer: manufacturer,
          },
          debug: true,
        }),
      });

      if (!response.ok) {
        const raw = await response.text();
        openDecideTestModal("HTTP " + response.status + "\n\n" + raw.slice(0, 500));
        return;
      }

      const data = await response.json();
      const debug = data && data.debug ? data.debug : null;
      const curl = debug && debug.curl ? debug.curl : null;
      const responseJson = data && data.raw ? data.raw : data;
      const topCategory = data && data.topCategory ? data.topCategory : null;

      let resolvedPath = "";
      if (topCategory && topCategory.id_category != null && kauflandLastItems && kauflandLastItems.length) {
        const idStr = String(topCategory.id_category);
        const rootItem = kauflandLastItems.find((x) => x && String(x.id) === "1");
        const rootPath = rootItem && typeof rootItem.path === "string" ? rootItem.path : null;
        const item = kauflandLastItems.find((x) => x && String(x.id) === idStr);

        if (item && typeof item.path === "string" && rootPath) {
          let rel = item.path;
          if (rel === rootPath) rel = "";
          if (rel.startsWith(rootPath + "/")) rel = rel.slice((rootPath + "/").length);
          if (rel) resolvedPath = "Všechny kategorie/" + rel;
          else resolvedPath = "Všechny kategorie";
        }
      }

      const output =
        (curl ? "curl (request):\n" + curl + "\n\n" : "") +
        "response JSON:\n" +
        JSON.stringify(responseJson, null, 2) +
        (topCategory ? "\n\ntopCategory (parsed):\n" + JSON.stringify(topCategory, null, 2) : "") +
        (resolvedPath ? "\n\nresolved Czech path by ID:\n" + resolvedPath : "");

      openDecideTestModal(output);
    } catch (error) {
      const msg = error && error.message ? error.message : String(error);
      openDecideTestModal("Chyba: " + msg);
    } finally {
      if (btnEl) btnEl.disabled = false;
    }
  }

  if (tbody) {
    tbody.addEventListener("click", function (event) {
      const btn = event.target && event.target.closest ? event.target.closest(".btnAiMatchCategory") : null;
      if (!btn) return;

      const productId = btn.getAttribute("data-product-id");
      const product = kauflandProductsById.get(String(productId));
      aiMatchCategoryForProduct(product, btn);
    });
  }

  function normalizeText(text) {
    return String(text == null ? "" : text)
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  function tokenize(text) {
    const norm = normalizeText(text);
    if (!norm) return [];
    return norm
      .split(" ")
      .map((t) => t.trim())
      .filter((t) => t.length >= 2);
  }

  function makeTokenSet(tokens) {
    return new Set(tokens);
  }

  function countTokenOverlap(setA, setB) {
    if (!setA || !setB) return 0;
    const small = setA.size <= setB.size ? setA : setB;
    const large = small === setA ? setB : setA;
    let count = 0;
    for (const t of small) if (large.has(t)) count++;
    return count;
  }

  function getKauflandCategoryDisplayPath(item) {
    // Mirrors logic used in `renderKauflandCategoriesFromItems`.
    if (!item || typeof item.path !== "string") return "";
    const rel = item.path;
    if (kauflandRootPath && rel === kauflandRootPath) return "Všechny kategorie";
    if (kauflandRootPath && rel.startsWith(kauflandRootPath + "/")) {
      return "Všechny kategorie/" + rel.slice((kauflandRootPath + "/").length);
    }
    return "Všechny kategorie/" + rel;
  }

  function getCategoryTokenSet(categoryId, displayPath, name) {
    if (kauflandCategoryTokenCache.has(categoryId)) return kauflandCategoryTokenCache.get(categoryId);
    const tokens = tokenize((displayPath || "") + " " + (name || ""));
    const set = makeTokenSet(tokens);
    kauflandCategoryTokenCache.set(categoryId, set);
    return set;
  }

  function pickTopCandidatesForProduct(product, allCategories, topK) {
    const productTokens = makeTokenSet(tokenize(product.heurekaCategoryName + " " + product.name + " " + product.description));

    const scored = [];
    for (const cat of allCategories) {
      if (!cat || cat.id == null) continue;
      const idStr = String(cat.id);
      const displayPath = getKauflandCategoryDisplayPath(cat);
      const tokenSet = getCategoryTokenSet(idStr, displayPath, cat.name);
      const score = countTokenOverlap(productTokens, tokenSet);
      if (score > 0) scored.push({ cat, idStr, displayPath, score });
    }

    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return String(a.displayPath).length - String(b.displayPath).length;
    });

    const picked = scored.slice(0, topK);
    if (picked.length) {
      return picked.map((x) => ({
        id: x.idStr,
        path: x.displayPath,
        name: x.cat.name || x.displayPath,
      }));
    }

    // Fallback if no token overlap.
    return allCategories
      .filter((c) => c && c.id != null)
      .slice()
      .sort((a, b) => getKauflandCategoryDisplayPath(a).length - getKauflandCategoryDisplayPath(b).length)
      .slice(0, topK)
      .map((c) => ({
        id: String(c.id),
        path: getKauflandCategoryDisplayPath(c),
        name: c.name || getKauflandCategoryDisplayPath(c),
      }));
  }

  async function aiMatchCategoryForProduct(product, btnEl) {
    if (!product) return;
    if (!kauflandLastItems || !kauflandLastItems.length) {
      showMsg("Nejdřív načti strom kategorií Kaufland.", "error");
      return;
    }

    const apiKey = getAiApiKey();
    const provider = getAiProvider();
    const model = getAiModel();
    if (!apiKey) {
      showMsg("Zadejte AI API key.", "error");
      return;
    }

    const td = btnEl ? btnEl.closest("td") : null;
    const tr = btnEl ? btnEl.closest("tr") : null;
    const resultEl = td ? td.querySelector(".aiResult") : null;
    const resultIdEl = tr ? tr.querySelector(".aiResultId") : null;
    if (btnEl) btnEl.disabled = true;
    if (resultEl) resultEl.textContent = "AI odhaduje...";
    if (resultIdEl) resultIdEl.textContent = "…";

    try {
      const topK = 20;
      const candidates = pickTopCandidatesForProduct(product, kauflandLastItems, topK);

      const response = await fetch(apiUrl("aiMatchCategory"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKey,
          provider,
          model,
          product: {
            heurekaCategoryName: product.heurekaCategoryName,
            title: product.name,
            description: product.description,
          },
          candidates,
          inputMode: "text_only",
        }),
      });

      if (!response.ok) {
        const raw = await response.text();
        throw new Error("HTTP " + response.status + ": " + raw.slice(0, 400));
      }

      const data = await response.json();
      const chosenPath = data && data.categoryPath ? data.categoryPath : null;
      const chosenId = data && data.categoryId ? String(data.categoryId) : null;

      if (resultEl) {
        if (chosenPath) {
          resultEl.textContent = chosenPath;
        } else {
          resultEl.textContent = "—";
        }
      }
      if (resultIdEl) resultIdEl.textContent = chosenId || "—";
    } catch (error) {
      const msg = error && error.message ? error.message : String(error);
      showMsg("AI chyba: " + msg, "error");
      if (resultEl) resultEl.textContent = "—";
      if (resultIdEl) resultIdEl.textContent = "—";
    } finally {
      if (btnEl) btnEl.disabled = false;
    }
  }

  const KAUFLAND_CLIENT_KEY_STORAGE = "kaufland_client_key_local";
  const KAUFLAND_SECRET_KEY_STORAGE = "kaufland_secret_key_local";
  const kauflandClientKeyInput = document.getElementById("kauflandClientKey");
  const kauflandSecretKeyInput = document.getElementById("kauflandSecretKey");
  const kauflandStorefrontInput = document.getElementById("kauflandStorefront");
  const kauflandLocaleInput = document.getElementById("kauflandLocale");
  const btnLoadKauflandCategories = document.getElementById("btnLoadKauflandCategories");
  const kauflandCategoriesOutput = document.getElementById("kauflandCategoriesOutput");
  const kauflandCategoriesCount = document.getElementById("kauflandCategoriesCount");
  const btnSaveKauflandTree = document.getElementById("btnSaveKauflandTree");
  const btnDownloadKauflandTree = document.getElementById("btnDownloadKauflandTree");
  const btnLoadSavedKauflandTree = document.getElementById("btnLoadSavedKauflandTree");
  const btnClearSavedKauflandTree = document.getElementById("btnClearSavedKauflandTree");
  const btnAddCategoriesToBaseLinkerTest = document.getElementById("btnAddCategoriesToBaseLinkerTest");
  const btnAddCategoriesTestCount = document.getElementById("btnAddCategoriesTestCount");
  const btnAddCategoriesToBaseLinkerAll = document.getElementById("btnAddCategoriesToBaseLinkerAll");
  const baseLinkerAddLog = document.getElementById("baseLinkerAddLog");

  const KAUFLAND_TREE_ITEMS_STORAGE_KEY = "kaufland_categories_tree_items_v1";
  let kauflandLastItems = [];
  let kauflandRootPath = null;
  let kauflandCategoryTokenCache = new Map();
  const BASELINKER_REQUEST_LIMIT_PER_MIN = 100;
  const BASELINKER_MIN_INTERVAL_MS = Math.ceil(60000 / BASELINKER_REQUEST_LIMIT_PER_MIN) + 50; // ~650ms

  const AI_API_KEY_STORAGE = "ai_api_key_local";
  const AI_PROVIDER_STORAGE = "ai_provider_local";
  const AI_MODEL_STORAGE = "ai_model_local";

  const OPENAI_MODELS = ["gpt-4o-mini", "gpt-4.1-mini", "gpt-4o"];
  const GEMINI_MODELS = ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.0-flash"];

  function getAiProvider() {
    const fromSelect = aiProviderSelect ? aiProviderSelect.value : "";
    const saved = sessionStorage.getItem(AI_PROVIDER_STORAGE) || "gemini";
    const provider = String(fromSelect || saved).trim().toLowerCase();
    return provider === "openai" ? "openai" : "gemini";
  }

  function getAiApiKey() {
    const saved = sessionStorage.getItem(AI_API_KEY_STORAGE) || "";
    const fromInput = aiApiKeyInput && aiApiKeyInput.value ? aiApiKeyInput.value : "";
    return String(fromInput || saved).trim();
  }

  function getAiModelOptions(provider) {
    return provider === "openai" ? OPENAI_MODELS : GEMINI_MODELS;
  }

  function renderAiModelOptions(provider, preferredModel) {
    if (!aiModelSelect) return;
    const options = getAiModelOptions(provider);
    aiModelSelect.innerHTML = "";
    options.forEach((m) => {
      const opt = document.createElement("option");
      opt.value = m;
      opt.textContent = m;
      aiModelSelect.appendChild(opt);
    });

    const selected = preferredModel && options.includes(preferredModel) ? preferredModel : options[0];
    aiModelSelect.value = selected;
    sessionStorage.setItem(AI_MODEL_STORAGE, selected);
  }

  function getAiModel() {
    const provider = getAiProvider();
    const options = getAiModelOptions(provider);
    const fromSelect = aiModelSelect ? aiModelSelect.value : "";
    if (fromSelect && options.includes(fromSelect)) return fromSelect;
    const saved = sessionStorage.getItem(AI_MODEL_STORAGE) || "";
    if (saved && options.includes(saved)) return saved;
    return options[0];
  }

  if (aiApiKeyInput) {
    const saved = sessionStorage.getItem(AI_API_KEY_STORAGE);
    if (saved) aiApiKeyInput.value = saved;
    aiApiKeyInput.addEventListener("change", function () {
      sessionStorage.setItem(AI_API_KEY_STORAGE, aiApiKeyInput.value || "");
    });
  }

  if (aiProviderSelect) {
    const savedProvider = sessionStorage.getItem(AI_PROVIDER_STORAGE) || "gemini";
    aiProviderSelect.value = savedProvider === "openai" ? "openai" : "gemini";
    renderAiModelOptions(aiProviderSelect.value, sessionStorage.getItem(AI_MODEL_STORAGE) || "");

    aiProviderSelect.addEventListener("change", function () {
      const provider = aiProviderSelect.value === "openai" ? "openai" : "gemini";
      sessionStorage.setItem(AI_PROVIDER_STORAGE, provider);
      renderAiModelOptions(provider, "");
    });
  } else {
    renderAiModelOptions("gemini", sessionStorage.getItem(AI_MODEL_STORAGE) || "");
  }

  if (aiModelSelect) {
    aiModelSelect.addEventListener("change", function () {
      sessionStorage.setItem(AI_MODEL_STORAGE, aiModelSelect.value || "");
    });
  }

  function getKauflandClientKey() {
    return (kauflandClientKeyInput && (kauflandClientKeyInput.value || "")).trim();
  }

  function getKauflandSecretKey() {
    return (kauflandSecretKeyInput && (kauflandSecretKeyInput.value || "")).trim();
  }

  function getKauflandStorefront() {
    const raw = kauflandStorefrontInput ? (kauflandStorefrontInput.value || "") : "de";
    const storefront = String(raw).trim();
    return storefront || "de";
  }

  function getKauflandLocale() {
    const raw = kauflandLocaleInput ? (kauflandLocaleInput.value || "") : "cs-CZ";
    const locale = String(raw).trim();
    return locale || "cs-CZ";
  }

  function renderKauflandCategoriesFromItems(items) {
    if (!kauflandCategoriesOutput) return;
    const safeItems = Array.isArray(items) ? items : [];

    const rootItem = safeItems.find((x) => x && String(x.id) === "1");
    const rootPath = rootItem && typeof rootItem.path === "string" ? rootItem.path : null;
    kauflandRootPath = rootPath;
    kauflandCategoryTokenCache = new Map();

    const toFullPath = (item) => {
      if (!item || typeof item.path !== "string") return null;
      let rel = item.path;

      // Replace real root title with a fixed prefix required by the UI.
      if (rootPath && rel === rootPath) rel = "";
      if (rootPath && rel.startsWith(rootPath + "/")) rel = rel.slice((rootPath + "/").length);

      if (rel) return "Všechny kategorie/" + rel;
      return "Všechny kategorie";
    };

    const lines = [];
    for (const it of safeItems) {
      if (!it || it.id == null) continue;
      const fullPath = toFullPath(it);
      if (!fullPath || typeof fullPath !== "string" || !fullPath.trim()) continue;
      lines.push({
        fullPath,
        id: String(it.id),
      });
    }

    lines.sort((a, b) => {
      if (a.fullPath === "Všechny kategorie") return -1;
      if (b.fullPath === "Všechny kategorie") return 1;
      const byPath = a.fullPath.localeCompare(b.fullPath, "cs");
      if (byPath !== 0) return byPath;
      return a.id.localeCompare(b.id, "cs");
    });

    kauflandCategoriesOutput.textContent = lines.map((l) => `${l.fullPath} (ID: ${l.id})`).join("\n");
    kauflandCategoriesOutput.classList.remove("hidden");
    if (kauflandCategoriesCount) {
      kauflandCategoriesCount.textContent = "Celkem kategorií: " + lines.length;
      kauflandCategoriesCount.classList.remove("hidden");
    }
    kauflandLastItems = safeItems;

    const has = kauflandLastItems.length > 0;
    if (btnSaveKauflandTree) btnSaveKauflandTree.disabled = !has;
    if (btnDownloadKauflandTree) btnDownloadKauflandTree.disabled = !has;

    refreshBaseLinkerUi();
  }

  function getBaseLinkerCategoryNamesFromItems(items) {
    const safeItems = Array.isArray(items) ? items : [];
    const rootItem = safeItems.find((x) => x && String(x.id) === "1");
    const rootPath = rootItem && typeof rootItem.path === "string" ? rootItem.path : null;

    const names = [];
    for (const it of safeItems) {
      if (!it || typeof it.path !== "string") continue;

      let rel = it.path;
      if (rootPath && rel === rootPath) continue; // skip root "Všechny kategorie"
      if (rootPath && rel.startsWith(rootPath + "/")) rel = rel.slice((rootPath + "/").length);
      if (!rel) continue;
      names.push(rel);
    }

    // De-duplicate by the full path string (e.g. "Média/Filmy").
    const uniq = Array.from(new Set(names));
    uniq.sort((a, b) => a.localeCompare(b, "cs"));
    return uniq;
  }

  function setBaseLinkerAddLog(text) {
    if (!baseLinkerAddLog) return;
    baseLinkerAddLog.textContent = text || "";
    baseLinkerAddLog.classList.remove("hidden");
  }

  function clearBaseLinkerAddLog() {
    if (!baseLinkerAddLog) return;
    baseLinkerAddLog.textContent = "";
    baseLinkerAddLog.classList.add("hidden");
  }

  function isBaseLinkerAuthed() {
    return !!(sessionStorage.getItem(TOKEN_STORAGE) || "").trim();
  }

  function getAddTestCount() {
    if (!btnAddCategoriesTestCount) return 5;
    const raw = btnAddCategoriesTestCount.value || "";
    const n = parseInt(String(raw).trim(), 10);
    if (Number.isNaN(n) || n <= 0) return 5;
    return n;
  }

  async function addCategoriesToBaseLinker(names, limit) {
    const clientInventoryId = BASELINKER_INVENTORY_ID;

    const toAdd = names.slice(0, limit);
    const total = toAdd.length;
    let okCount = 0;
    let failCount = 0;
    let log = "";

    log = "Start: přidávám " + total + " kategorií do BaseLinkeru...\n";
    setBaseLinkerAddLog(log);

    for (let i = 0; i < toAdd.length; i++) {
      const name = toAdd[i];
      log += `[${i + 1}/${total}] přidávám: ${name}\n`;
      setBaseLinkerAddLog(log);

      try {
        await callBaseLinker("addInventoryCategory", {
          inventory_id: clientInventoryId,
          name: name,
          parent_id: 0,
        });
        okCount++;
      } catch (e) {
        failCount++;
        const msg = e && e.message ? e.message : String(e);
        log += `  chyba: ${msg}\n`;
        setBaseLinkerAddLog(log);
      }

      if (i < toAdd.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, BASELINKER_MIN_INTERVAL_MS));
      }
    }

    log += `\nHotovo. OK: ${okCount}, chyba: ${failCount}\n`;
    setBaseLinkerAddLog(log);
  }

  function clearKauflandCategoriesOutput() {
    if (!kauflandCategoriesOutput) return;
    kauflandCategoriesOutput.textContent = "";
    kauflandCategoriesOutput.classList.add("hidden");
    if (kauflandCategoriesCount) {
      kauflandCategoriesCount.textContent = "Celkem kategorií: 0";
      kauflandCategoriesCount.classList.add("hidden");
    }
    kauflandLastItems = [];

    if (btnSaveKauflandTree) btnSaveKauflandTree.disabled = true;
    if (btnDownloadKauflandTree) btnDownloadKauflandTree.disabled = true;

    refreshBaseLinkerUi();
  }

  async function loadKauflandCategoriesTree() {
    if (!btnLoadKauflandCategories || !kauflandCategoriesOutput) return;

    const clientKey = getKauflandClientKey();
    const secretKey = getKauflandSecretKey();
    const storefront = getKauflandStorefront();
    const locale = getKauflandLocale();
    // UI už nemá "batch" pole, backend už primárně používá /categories/tree.
    // Tahle hodnota zůstává jen pro případ, že by fallback padl na BFS.
    let batchSize = 500;
    let retryCount = 0;

    if (!clientKey) {
      showMsg("Zadejte Kaufland client key.", "error");
      return;
    }
    if (!secretKey) {
      showMsg("Zadejte Kaufland secret key.", "error");
      return;
    }

    btnLoadKauflandCategories.disabled = true;
    if (btnSaveKauflandTree) btnSaveKauflandTree.disabled = true;
    if (btnDownloadKauflandTree) btnDownloadKauflandTree.disabled = true;
    showMsg("Načítám strom kategorií Kaufland...", "info");
    kauflandCategoriesOutput.classList.add("hidden");
    kauflandCategoriesOutput.textContent = "";
    if (kauflandCategoriesCount) {
      kauflandCategoriesCount.textContent = "Celkem kategorií: 0";
      kauflandCategoriesCount.classList.add("hidden");
    }

    try {
      let state = null;
      let allItems = [];
      let rootPath = null;

      function toFullPath(item) {
        if (!item || typeof item.path !== "string") return null;
        let rel = item.path;

        // Replace real root title with a fixed prefix required by the UI.
        if (rootPath && rel === rootPath) rel = "";
        if (rootPath && rel.startsWith(rootPath + "/")) rel = rel.slice((rootPath + "/").length);

        if (rel) return "Všechny kategorie/" + rel;
        return "Všechny kategorie";
      }

      function rebuildAndRender() {
        renderKauflandCategoriesFromItems(allItems);
      }

      while (true) {
        showMsg("Načítám dávku kategorií (batch " + batchSize + ")...", "info");

        try {
          const response = await fetch(apiUrl("kauflandCategories"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              clientKey: clientKey,
              secretKey: secretKey,
              storefront: storefront,
              locale: locale,
              batchSize: batchSize,
              state: state,
            }),
          });

          if (!response.ok) {
            const raw = await response.text();
            const rawText = String(raw || "");
            const timeoutLike = /TimeoutError|timed out|Task timed out/i.test(rawText);

            if (timeoutLike && batchSize > 1 && retryCount < 5) {
              retryCount++;
              batchSize = Math.max(1, Math.floor(batchSize / 2));
              showMsg(
                "Timeout při načítání, snižuji batch na " + batchSize + " a zkouším znovu (" + retryCount + "/5).",
                "info"
              );
              continue;
            }

            throw new Error("HTTP " + response.status + ": " + rawText.slice(0, 400));
          }

          const data = await response.json();
          const newItems = Array.isArray(data.newItems) ? data.newItems : [];
          state = data.state || null;

          allItems = allItems.concat(newItems);
          const rootItem = allItems.find((x) => x && String(x.id) === "1");
          if (!rootPath && rootItem && typeof rootItem.path === "string") {
            rootPath = rootItem.path;
          }

          // success: reset retry counters
          retryCount = 0;

          rebuildAndRender();

          const truncated = !!data.truncated;
          showMsg(
            "Načteno " + allItems.length + " kategorií (Kaufland)." + (truncated ? " Pokračuju..." : ""),
            "success"
          );

          if (!truncated) break;

          // Small delay between batches to reduce UI pressure.
          await new Promise((resolve) => setTimeout(resolve, 250));
        } catch (error) {
          const msg = error && error.message ? error.message : String(error);
          const timeoutLike = /TimeoutError|timed out|Task timed out/i.test(msg);

          if (timeoutLike && batchSize > 1 && retryCount < 5) {
            retryCount++;
            batchSize = Math.max(1, Math.floor(batchSize / 2));
            showMsg(
              "Timeout při načítání, snižuji batch na " + batchSize + " a zkouším znovu (" + retryCount + "/5).",
              "info"
            );
            continue;
          }

          showMsg("Stažení kategorií se zastavilo: " + msg, "error");
          break;
        }
      }
    } catch (error) {
      showMsg("Chyba: " + (error.message || String(error)), "error");
    } finally {
      btnLoadKauflandCategories.disabled = false;
    }
  }

  if (btnLoadKauflandCategories) {
    btnLoadKauflandCategories.addEventListener("click", loadKauflandCategoriesTree);
  }

  if (btnSaveKauflandTree) {
    btnSaveKauflandTree.addEventListener("click", function () {
      try {
        if (!kauflandLastItems || !kauflandLastItems.length) {
          showMsg("Není co uložit (strom nebyl načten).", "error");
          return;
        }
        localStorage.setItem(KAUFLAND_TREE_ITEMS_STORAGE_KEY, JSON.stringify(kauflandLastItems));
        showMsg("Strom kategorií uložen do prohlížeče.", "success");
      } catch (e) {
        showMsg("Chyba při ukládání: " + (e && e.message ? e.message : String(e)), "error");
      }
    });
  }

  if (btnDownloadKauflandTree) {
    btnDownloadKauflandTree.addEventListener("click", function () {
      try {
        const items = kauflandLastItems && kauflandLastItems.length
          ? kauflandLastItems
          : (() => {
              const raw = localStorage.getItem(KAUFLAND_TREE_ITEMS_STORAGE_KEY);
              if (!raw) return [];
              const parsed = JSON.parse(raw);
              return Array.isArray(parsed) ? parsed : [];
            })();

        if (!items.length) {
          showMsg("Nic ke stažení (strom nebyl načten ani uložen).", "error");
          return;
        }

        const blob = new Blob([JSON.stringify(items, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "categories-tree.json";
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      } catch (e) {
        showMsg("Chyba při stahování: " + (e && e.message ? e.message : String(e)), "error");
      }
    });
  }

  if (btnLoadSavedKauflandTree) {
    btnLoadSavedKauflandTree.addEventListener("click", function () {
      try {
        const raw = localStorage.getItem(KAUFLAND_TREE_ITEMS_STORAGE_KEY);
        if (!raw) {
          showMsg("V prohlížeči není uložený strom kategorií.", "error");
          return;
        }
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed) || !parsed.length) {
          showMsg("Uložený strom je prázdný.", "error");
          return;
        }

        renderKauflandCategoriesFromItems(parsed);
        showMsg("Načteno uložených kategorií: " + parsed.length + ".", "success");
      } catch (e) {
        showMsg("Chyba při načítání uloženého stromu: " + (e && e.message ? e.message : String(e)), "error");
      }
    });
  }

  if (btnClearSavedKauflandTree) {
    btnClearSavedKauflandTree.addEventListener("click", function () {
      try {
        localStorage.removeItem(KAUFLAND_TREE_ITEMS_STORAGE_KEY);
        clearKauflandCategoriesOutput();
        clearBaseLinkerAddLog();
        showMsg("Uložený strom byl vymazán.", "success");
      } catch (e) {
        showMsg(
          "Chyba při mazání: " + (e && e.message ? e.message : String(e)),
          "error"
        );
      }
    });
  }

  if (btnAddCategoriesToBaseLinkerTest) {
    btnAddCategoriesToBaseLinkerTest.addEventListener("click", async function () {
      try {
        clearBaseLinkerAddLog();
        btnAddCategoriesToBaseLinkerTest.disabled = true;
        btnAddCategoriesToBaseLinkerAll.disabled = true;

        if (!isBaseLinkerAuthed()) {
          showMsg("Nejsi přihlášený do BaseLinkeru.", "error");
          return;
        }

        const names = getBaseLinkerCategoryNamesFromItems(kauflandLastItems);
        const n = getAddTestCount();
        await addCategoriesToBaseLinker(names, n);
      } finally {
        refreshBaseLinkerUi();
      }
    });
  }

  if (btnAddCategoriesToBaseLinkerAll) {
    btnAddCategoriesToBaseLinkerAll.addEventListener("click", async function () {
      try {
        clearBaseLinkerAddLog();
        btnAddCategoriesToBaseLinkerTest.disabled = true;
        btnAddCategoriesToBaseLinkerAll.disabled = true;

        if (!isBaseLinkerAuthed()) {
          showMsg("Nejsi přihlášený do BaseLinkeru.", "error");
          return;
        }

        const names = getBaseLinkerCategoryNamesFromItems(kauflandLastItems);
        await addCategoriesToBaseLinker(names, names.length);
      } finally {
        refreshBaseLinkerUi();
      }
    });
  }

  // Try to restore saved tree on load.
  try {
    const raw = localStorage.getItem(KAUFLAND_TREE_ITEMS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length) {
        renderKauflandCategoriesFromItems(parsed);
      }
    }
  } catch {
    // ignore localStorage issues
  }

  // Restore BaseLinker login state (token lives in sessionStorage).
  if (inventoryInput) inventoryInput.value = String(BASELINKER_INVENTORY_ID);

  if (kauflandClientKeyInput) {
    const savedKauflandClientKey = localStorage.getItem(KAUFLAND_CLIENT_KEY_STORAGE);
    if (savedKauflandClientKey) kauflandClientKeyInput.value = savedKauflandClientKey;

    kauflandClientKeyInput.addEventListener("change", function () {
      localStorage.setItem(KAUFLAND_CLIENT_KEY_STORAGE, kauflandClientKeyInput.value || "");
    });
  }

  if (kauflandSecretKeyInput) {
    const savedKauflandSecretKey = localStorage.getItem(KAUFLAND_SECRET_KEY_STORAGE);
    if (savedKauflandSecretKey) kauflandSecretKeyInput.value = savedKauflandSecretKey;

    kauflandSecretKeyInput.addEventListener("change", function () {
      localStorage.setItem(KAUFLAND_SECRET_KEY_STORAGE, kauflandSecretKeyInput.value || "");
    });
  }

  if (tokenInput) {
    tokenInput.addEventListener("change", function () {
      sessionStorage.setItem(TOKEN_STORAGE, tokenInput.value || "");
    });
  }

  // BaseLinker login UI handling
  function refreshBaseLinkerUi() {
    const tokenPresent = !!(sessionStorage.getItem(TOKEN_STORAGE) || "").trim();
    if (btnLoad) btnLoad.disabled = !tokenPresent;
    if (baseLinkerStatus) {
      baseLinkerStatus.textContent = tokenPresent ? "Přihlášen." : "Nejste přihlášen.";
    }

    const canAdd = tokenPresent && kauflandLastItems && kauflandLastItems.length > 0;
    if (btnAddCategoriesToBaseLinkerTest) btnAddCategoriesToBaseLinkerTest.disabled = !canAdd;
    if (btnAddCategoriesToBaseLinkerAll) btnAddCategoriesToBaseLinkerAll.disabled = !canAdd;
  }

  if (btnOpenBaseLinkerLogin) {
    btnOpenBaseLinkerLogin.addEventListener("click", function () {
      window.location.href = "login.html";
    });
  }

  if (btnCancelBaseLinkerLogin) {
    btnCancelBaseLinkerLogin.addEventListener("click", function () {
      if (baseLinkerLoginModal) baseLinkerLoginModal.classList.add("hidden");
      showMsg("", "info");
    });
  }

  if (btnLoginBaseLinker) {
    btnLoginBaseLinker.addEventListener("click", function () {
      const token = tokenInput ? (tokenInput.value || "").trim() : "";
      if (!token) {
        showLoginMsg("Zadejte BaseLinker API token.", "error");
        return;
      }
      sessionStorage.setItem(TOKEN_STORAGE, token);
      if (baseLinkerLoginModal) baseLinkerLoginModal.classList.add("hidden");
      refreshBaseLinkerUi();
    });
  }

  // Auto-update UI based on sessionStorage token.
  refreshBaseLinkerUi();
})();
