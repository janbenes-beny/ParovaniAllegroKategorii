(function () {
  const TOKEN_STORAGE = "bl_token_local";
  const INVENTORY_STORAGE = "bl_inventory_local";
  const BASELINKER_INVENTORY_ID = 5257;
  const MAX_PRODUCTS_TO_SHOW = 50;

  const btnLoad = document.getElementById("btnLoad");
  const btnLoadAll = document.getElementById("btnLoadAll");
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

  const paginationControls = document.getElementById("paginationControls");
  const btnPrevPage = document.getElementById("btnPrevPage");
  const btnNextPage = document.getElementById("btnNextPage");
  const paginationInfoEl = document.getElementById("paginationInfo");

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
  const PAGE_SIZE = MAX_PRODUCTS_TO_SHOW;
  let allProductIds = [];
  let currentPage = 1;
  let totalPages = 1;
  let heurekaCategoryMapCache = new Map();
  let isLoadingProducts = false;

  function updatePaginationUi() {
    if (!paginationControls || !btnPrevPage || !btnNextPage || !paginationInfoEl) return;

    btnPrevPage.disabled = currentPage <= 1;
    btnNextPage.disabled = currentPage >= totalPages;
    paginationControls.style.display = totalPages > 1 ? "block" : "none";

    const total = allProductIds ? allProductIds.length : 0;
    paginationInfoEl.textContent = "Stránka " + currentPage + " z " + totalPages + " (celkem " + total + " produktů)";
  }

  function resetSelectionUi() {
    if (selectAllProductsEl) {
      selectAllProductsEl.checked = false;
      selectAllProductsEl.indeterminate = false;
    }
    if (btnAiEstimateSelected) btnAiEstimateSelected.disabled = true;
    if (btnPushSelectedToBas) btnPushSelectedToBas.disabled = true;
  }

  function renderRows(rows) {
    tbody.innerHTML = "";

    rows.forEach((row) => {
      const tr = document.createElement("tr");
      tr.innerHTML =
        '<td><input type="checkbox" class="productRowCheck" data-product-id="' + escapeHtml(row.id) + '"></td>' +
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
        '<td class="aiResultId">—</td>' +
        '<td>' +
        '<button type="button" class="btnPushEstimatedCategoryToBas" data-product-id="' +
        escapeHtml(row.id) +
        '">Ulož ID do Basu</button>' +
        '<div class="basSyncStatus desc" style="margin-top: 6px;">—</div>' +
        "</td>";

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

  async function renderPage(inventoryId) {
    const start = (currentPage - 1) * PAGE_SIZE;
    const pageIds = allProductIds.slice(start, start + PAGE_SIZE);
    if (!pageIds.length) return;

    // Fetch only the items shown on the page.
    const products = await fetchProductsDataByIds(inventoryId, pageIds);
    const rows = [];

    pageIds.forEach((productId) => {
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
      const heurekaCategoryName = heurekaCategoryMapCache.get(categoryId) || "—";
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

    resetSelectionUi();
    updateSelectAllState();
    updatePaginationUi();
  }

  async function loadProducts(maxProducts) {
    const inventoryId = getInventoryId();
    if (!inventoryId || Number.isNaN(inventoryId)) {
      showMsg("Zadejte platné Inventory ID.", "error");
      return;
    }
    if (!getToken()) {
      showMsg("Zadejte API token.", "error");
      return;
    }

    if (isLoadingProducts) return;
    isLoadingProducts = true;

    btnLoad.disabled = true;
    if (btnLoadAll) btnLoadAll.disabled = true;
    if (btnPrevPage) btnPrevPage.disabled = true;
    if (btnNextPage) btnNextPage.disabled = true;

    showMsg("Načítám seznam produktů z BaseLinker...", "info");
    tableWrap.classList.add("hidden");

    try {
      allProductIds = await fetchAllProductIds(inventoryId, maxProducts);
      currentPage = 1;
      totalPages = Math.max(1, Math.ceil(allProductIds.length / PAGE_SIZE));

      heurekaCategoryMapCache = new Map();
      try {
        const categoriesData = await callBaseLinker("getInventoryCategories", { inventory_id: inventoryId });
        heurekaCategoryMapCache = mapCategories(categoriesData.categories || categoriesData);
      } catch (categoryError) {
        // Pokud categories endpoint není dostupný, zobrazíme aspoň ID kategorie.
        heurekaCategoryMapCache = new Map();
      }

      showMsg("Načítám stránku 1…", "info");
      await renderPage(inventoryId);
      tableWrap.classList.remove("hidden");

      showMsg("Načteno " + allProductIds.length + " produktů. Zobrazuji stránku 1.", "success");
    } catch (error) {
      showMsg("Chyba: " + (error.message || String(error)), "error");
    } finally {
      isLoadingProducts = false;
      refreshBaseLinkerUi();
      updatePaginationUi();
    }
  }

  btnLoad.addEventListener("click", function () {
    loadProducts(PAGE_SIZE);
  });

  if (btnLoadAll) {
    btnLoadAll.addEventListener("click", function () {
      // Effectively "no limit" for fetchAllProductIds.
      loadProducts(1000000000);
    });
  }

  async function gotoPage(page) {
    if (isLoadingProducts) return;
    if (!allProductIds || !allProductIds.length) return;
    if (page < 1 || page > totalPages) return;

    const inventoryId = getInventoryId();
    if (!inventoryId || Number.isNaN(inventoryId)) return;

    isLoadingProducts = true;
    if (btnLoad) btnLoad.disabled = true;
    if (btnLoadAll) btnLoadAll.disabled = true;
    if (btnPrevPage) btnPrevPage.disabled = true;
    if (btnNextPage) btnNextPage.disabled = true;

    try {
      currentPage = page;
      showMsg("Načítám stránku " + currentPage + "…", "info");
      await renderPage(inventoryId);
    } catch (e) {
      const msg = e && e.message ? e.message : String(e);
      showMsg("Chyba při stránkování: " + msg, "error");
    } finally {
      isLoadingProducts = false;
      refreshBaseLinkerUi();
      updatePaginationUi();
    }
  }

  if (btnPrevPage) {
    btnPrevPage.addEventListener("click", function () {
      gotoPage(currentPage - 1);
    });
  }
  if (btnNextPage) {
    btnNextPage.addEventListener("click", function () {
      gotoPage(currentPage + 1);
    });
  }

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
      const aiBtn = event.target && event.target.closest ? event.target.closest(".btnAiMatchCategory") : null;
      if (aiBtn) {
        const productId = aiBtn.getAttribute("data-product-id");
        const product = kauflandProductsById.get(String(productId));
        aiMatchCategoryForProduct(product, aiBtn);
        return;
      }

      const basBtn = event.target && event.target.closest ? event.target.closest(".btnPushEstimatedCategoryToBas") : null;
      if (basBtn) {
        const productId = basBtn.getAttribute("data-product-id");
        const product = kauflandProductsById.get(String(productId));
        pushEstimatedCategoryToBas(product, basBtn);
      }
    });
  }

  const selectAllProductsEl = document.getElementById("selectAllProducts");
  const extraFieldKeySelect = document.getElementById("extraFieldKey");
  const btnAiEstimateSelected = document.getElementById("btnAiEstimateSelected");
  const btnPushSelectedToBas = document.getElementById("btnPushSelectedToBas");

  function getSelectedProductIds() {
    if (!tbody) return [];
    const checked = tbody.querySelectorAll('.productRowCheck:checked');
    return Array.from(checked).map((cb) => cb.getAttribute("data-product-id")).filter(Boolean);
  }

  function getSelectedProducts() {
    const ids = getSelectedProductIds();
    return ids.map((id) => kauflandProductsById.get(String(id))).filter(Boolean);
  }

  function getExtraFieldKey() {
    // Value is like "extra_field_10902"
    const v = extraFieldKeySelect && extraFieldKeySelect.value ? extraFieldKeySelect.value : "extra_field_10902";
    return String(v).trim();
  }

  function updateSelectAllState() {
    if (!selectAllProductsEl) return;
    if (!tbody) return;
    const checks = tbody.querySelectorAll(".productRowCheck");
    const checked = tbody.querySelectorAll(".productRowCheck:checked");
    if (!checks.length) {
      selectAllProductsEl.checked = false;
      selectAllProductsEl.indeterminate = false;
      return;
    }
    selectAllProductsEl.checked = checked.length > 0 && checked.length === checks.length;
    selectAllProductsEl.indeterminate = checked.length > 0 && checked.length < checks.length;
  }

  if (selectAllProductsEl) {
    selectAllProductsEl.addEventListener("change", function () {
      if (!tbody) return;
      const all = tbody.querySelectorAll(".productRowCheck");
      all.forEach((cb) => {
        cb.checked = !!selectAllProductsEl.checked;
      });
      updateSelectAllState();
      if (btnAiEstimateSelected) btnAiEstimateSelected.disabled = !getSelectedProductIds().length;
      if (btnPushSelectedToBas) btnPushSelectedToBas.disabled = !getSelectedProductIds().length;
    });
  }

  if (tbody) {
    tbody.addEventListener("change", function (event) {
      const target = event.target;
      if (!(target instanceof HTMLInputElement)) return;
      if (!target.classList.contains("productRowCheck")) return;
      updateSelectAllState();
      if (btnAiEstimateSelected) btnAiEstimateSelected.disabled = !getSelectedProductIds().length;
      if (btnPushSelectedToBas) btnPushSelectedToBas.disabled = !getSelectedProductIds().length;
    });
  }

  if (btnAiEstimateSelected) {
    btnAiEstimateSelected.addEventListener("click", async function () {
      const selectedProducts = getSelectedProducts();
      if (!selectedProducts.length) {
        showMsg("Nevybrali jste žádné produkty.", "error");
        return;
      }
      btnAiEstimateSelected.disabled = true;
      if (btnPushSelectedToBas) btnPushSelectedToBas.disabled = true;
      showMsg("AI odhad pro vybrané: začínám…", "info");

      try {
        let completed = 0;
        const CONCURRENCY = 4;
        let nextIndex = 0;

        async function worker() {
          while (true) {
            const i = nextIndex++;
            if (i >= selectedProducts.length) return;

            const product = selectedProducts[i];
            const aiBtn = tbody
              ? tbody.querySelector('.btnAiMatchCategory[data-product-id="' + escapeHtml(String(product.id)) + '"]')
              : null;

            await aiMatchCategoryForProduct(product, aiBtn);

            completed++;
            showMsg("AI odhad: " + completed + "/" + selectedProducts.length, "info");
          }
        }

        await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
        showMsg("AI odhad pro vybrané dokončen.", "success");
      } catch (e) {
        const msg = e && e.message ? e.message : String(e);
        showMsg("AI dávka: chyba: " + msg, "error");
      } finally {
        btnAiEstimateSelected.disabled = false;
        if (btnPushSelectedToBas) btnPushSelectedToBas.disabled = !getSelectedProductIds().length;
      }
    });
  }

  async function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  if (btnPushSelectedToBas) {
    btnPushSelectedToBas.addEventListener("click", async function () {
      const selectedProducts = getSelectedProducts();
      if (!selectedProducts.length) {
        showMsg("Nevybrali jste žádné produkty.", "error");
        return;
      }

      const extraFieldKey = getExtraFieldKey();
      const productsWithEstimate = selectedProducts.filter((p) => p && p.estimatedCategoryId);
      if (!productsWithEstimate.length) {
        showMsg("Pro vybrané produkty chybí odhadnuté kategorie. Nejprve spusťte AI odhad.", "error");
        return;
      }

      const productsToSave = productsWithEstimate.filter((p) => String(p.estimatedExtraFieldKey || "").trim() === String(extraFieldKey).trim());
      if (!productsToSave.length) {
        showMsg(
          "U vybraných produktů odhad neodpovídá zvolenému `extraFieldKey`. Spusťte AI odhad znovu.",
          "error"
        );
        return;
      }

      btnAiEstimateSelected && (btnAiEstimateSelected.disabled = true);
      btnPushSelectedToBas.disabled = true;

      try {
        const inventoryId = getInventoryId();
        const REQUEST_DELAY_MS = 650; // ~92 requestů/min, bezpečně pod 100/min

        for (let i = 0; i < productsToSave.length; i++) {
          const p = productsToSave[i];
          const productIdNum = parseInt(String(p.id), 10);
          if (Number.isNaN(productIdNum)) continue;

          const catId = String(p.estimatedCategoryId).trim();
          if (!catId) continue;

          // Mark UI
          if (tbody) {
            const tr = tbody.querySelector('button.btnPushEstimatedCategoryToBas[data-product-id="' + escapeHtml(String(p.id)) + '"]')?.closest("tr");
            const statusEl = tr ? tr.querySelector(".basSyncStatus") : null;
            if (statusEl) statusEl.textContent = "Ukládám…";
          }

          showMsg("Ukládám do Base: " + (i + 1) + "/" + productsToSave.length, "info");

          // BaseLinker: addInventoryProduct per product (spolehlivé, protože setInventoryProductsData není dostupné)
          await callBaseLinker("addInventoryProduct", {
            inventory_id: parseInt(String(inventoryId), 10),
            product_id: productIdNum,
            text_fields: {
              [extraFieldKey]: catId,
            },
          });

          if (tbody) {
            const btn = tbody
              ? tbody.querySelector('button.btnPushEstimatedCategoryToBas[data-product-id="' + escapeHtml(String(p.id)) + '"]')
              : null;
            const tr = btn ? btn.closest("tr") : null;
            const statusEl = tr ? tr.querySelector(".basSyncStatus") : null;
            if (statusEl) statusEl.textContent = "Uloženo.";
          }

          // Rate limiting
          if (i + 1 < productsToSave.length) await sleep(REQUEST_DELAY_MS);
        }

        showMsg("Uložení do Base dokončeno.", "success");
      } catch (e) {
        const msg = e && e.message ? e.message : String(e);
        showMsg("Uložení do Base: chyba: " + msg, "error");
      } finally {
        btnAiEstimateSelected && (btnAiEstimateSelected.disabled = false);
        btnPushSelectedToBas.disabled = !getSelectedProductIds().length;
      }
    });
  }

  async function pushEstimatedCategoryToBas(product, btnEl) {
    if (!product) return;
    if (!getToken()) {
      showMsg("Nejdřív se přihlas do BaseLinkeru.", "error");
      return;
    }

    const estimatedCategoryId = product.estimatedCategoryId ? String(product.estimatedCategoryId).trim() : "";
    const extraFieldKey = getExtraFieldKey();
    const estimatedExtraFieldKey = product.estimatedExtraFieldKey ? String(product.estimatedExtraFieldKey).trim() : "";
    if (!estimatedCategoryId) {
      showMsg("Nejdřív spusť AI odhad kategorie pro tento produkt.", "error");
      return;
    }

    if (!estimatedExtraFieldKey || estimatedExtraFieldKey !== String(extraFieldKey).trim()) {
      showMsg(
        "Odhad tohoto produktu neodpovídá zvolenému `extraFieldKey`. Spusťte AI odhad znovu.",
        "error"
      );
      return;
    }

    const tr = btnEl ? btnEl.closest("tr") : null;
    const statusEl = tr ? tr.querySelector(".basSyncStatus") : null;
    if (btnEl) btnEl.disabled = true;
    if (statusEl) statusEl.textContent = "Ukládám do BASu...";

    try {
      const inventoryId = getInventoryId();
      const productIdNum = parseInt(String(product.id), 10);
      if (Number.isNaN(productIdNum)) {
        throw new Error("Neplatné ID produktu: " + String(product.id));
      }

      let lastError = null;
      const methodAttempts = [
        // 1) Ověřený způsob z appKaufCIsteni.js (update konkrétního produktu přes addInventoryProduct + text_fields)
        {
          method: "addInventoryProduct",
          parameters: {
            inventory_id: parseInt(String(inventoryId), 10),
            product_id: productIdNum,
            text_fields: {
              [extraFieldKey]: estimatedCategoryId,
            },
          },
        },
        // 2) Fallback přes setInventoryProductsData
        {
          method: "setInventoryProductsData",
          parameters: {
            inventory_id: inventoryId,
            products: {
              [String(productIdNum)]: {
                extra_fields: {
                  [extraFieldKey]: estimatedCategoryId,
                },
              },
            },
          },
        },
        // 3) Fallback přes setInventoryProductData
        {
          method: "setInventoryProductData",
          parameters: {
            inventory_id: inventoryId,
            product_id: productIdNum,
            data: {
              extra_fields: {
                  [extraFieldKey]: estimatedCategoryId,
              },
            },
          },
        },
      ];

      let ok = false;
      for (const attempt of methodAttempts) {
        try {
          await callBaseLinker(attempt.method, attempt.parameters);
          ok = true;
          break;
        } catch (e) {
          lastError = e;
        }
      }

      if (!ok) {
        throw lastError || new Error("Nepodařilo se uložit kategorii do BASu.");
      }

      if (statusEl) statusEl.textContent = "Uloženo.";
      showMsg("Kategorie " + estimatedCategoryId + " byla uložena do " + extraFieldKey + ".", "success");
    } catch (error) {
      const msg = error && error.message ? error.message : String(error);
      if (statusEl) statusEl.textContent = "Chyba.";
      showMsg("Chyba při ukládání do BASu: " + msg, "error");
    } finally {
      if (btnEl) btnEl.disabled = false;
    }
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

  function getAllegroCategoryDisplayPath(item) {
    if (!item || typeof item.path !== "string") return "";
    const rel = item.path.trim();
    return rel ? "Všechny kategorie/" + rel : "Všechny kategorie";
  }

  function getAllegroCategoryTokenSet(categoryId, displayPath, name) {
    if (allegroCategoryTokenCache.has(categoryId)) return allegroCategoryTokenCache.get(categoryId);
    const tokens = tokenize((displayPath || "") + " " + (name || ""));
    const set = makeTokenSet(tokens);
    allegroCategoryTokenCache.set(categoryId, set);
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

  function pickTopCandidatesForProductAllegro(product, allCategories, topK) {
    const productTokens = makeTokenSet(tokenize(product.heurekaCategoryName + " " + product.name + " " + product.description));

    const scored = [];
    for (const cat of allCategories) {
      if (!cat || cat.id == null) continue;
      const idStr = String(cat.id);
      const displayPath = getAllegroCategoryDisplayPath(cat);
      const tokenSet = getAllegroCategoryTokenSet(idStr, displayPath, cat.name);
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
      .sort((a, b) => getAllegroCategoryDisplayPath(a).length - getAllegroCategoryDisplayPath(b).length)
      .slice(0, topK)
      .map((c) => ({
        id: String(c.id),
        path: getAllegroCategoryDisplayPath(c),
        name: c.name || getAllegroCategoryDisplayPath(c),
      }));
  }

  const AI_ESTIMATE_CACHE_V1_PREFIX = "ai_estimate_cache_v1";

  function getAiEstimateCacheKey(productId, extraFieldKey) {
    return (
      AI_ESTIMATE_CACHE_V1_PREFIX +
      "|" +
      String(extraFieldKey == null ? "" : extraFieldKey).trim() +
      "|" +
      String(productId == null ? "" : productId).trim()
    );
  }

  function safeLocalStorageGet(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  function safeLocalStorageSet(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {
      // ignore storage quota / privacy errors
    }
  }

  function readCachedAiEstimate(productId, extraFieldKey) {
    const key = getAiEstimateCacheKey(productId, extraFieldKey);
    const raw = safeLocalStorageGet(key);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return null;
      const categoryId = parsed.categoryId != null ? String(parsed.categoryId).trim() : "";
      if (!categoryId) return null;
      const categoryPath = parsed.categoryPath != null ? String(parsed.categoryPath) : "";
      return { categoryId, categoryPath };
    } catch {
      return null;
    }
  }

  function writeCachedAiEstimate(productId, extraFieldKey, estimate) {
    const key = getAiEstimateCacheKey(productId, extraFieldKey);
    if (!estimate || typeof estimate !== "object") return;
    const categoryId = estimate.categoryId != null ? String(estimate.categoryId).trim() : "";
    if (!categoryId) return;
    const categoryPath = estimate.categoryPath != null ? String(estimate.categoryPath) : "";
    safeLocalStorageSet(key, JSON.stringify({ categoryId, categoryPath }));
  }

  async function aiMatchCategoryForProduct(product, btnEl) {
    if (!product) return;
    const extraFieldKey = getExtraFieldKey();
    const marketplace = String(extraFieldKey) === "extra_field_5755" ? "allegro" : "kaufland";
    const topK = 20;

    // Keep marketplace binding to prevent saving estimates for a different extraFieldKey.
    product.estimatedExtraFieldKey = String(extraFieldKey).trim();

    const td = btnEl ? btnEl.closest("td") : null;
    const tr = btnEl ? btnEl.closest("tr") : null;
    const resultEl = td ? td.querySelector(".aiResult") : null;
    const resultIdEl = tr ? tr.querySelector(".aiResultId") : null;
    if (btnEl) btnEl.disabled = true;
    if (resultEl) resultEl.textContent = "AI odhaduje...";
    if (resultIdEl) resultIdEl.textContent = "…";

    // Prevent stale estimates from a previous run from being saved.
    product.estimatedCategoryId = "";
    product.estimatedCategoryPath = "";

    // If we already have an estimate for this (productId + extraFieldKey), reuse it.
    const cached = readCachedAiEstimate(product.id, extraFieldKey);
    if (cached) {
      if (resultEl) resultEl.textContent = cached.categoryPath || "—";
      if (resultIdEl) resultIdEl.textContent = cached.categoryId || "—";
      product.estimatedCategoryId = cached.categoryId || "";
      product.estimatedCategoryPath = cached.categoryPath || "";
      if (btnEl) btnEl.disabled = false;
      return;
    }

    const apiKey = getAiApiKey();
    const provider = getAiProvider();
    const model = getAiModel();
    if (!apiKey) {
      showMsg("Zadejte AI API key.", "error");
      if (btnEl) btnEl.disabled = false;
      return;
    }

    try {
      // Only build candidates/tree if we don't have cached answer.
      let candidates = [];
      if (marketplace === "allegro") {
        if (!allegroLastItems || !allegroLastItems.length) {
          showMsg("Nejdřív načti strom kategorií Allegro.", "error");
          return;
        }
        candidates = pickTopCandidatesForProductAllegro(product, allegroLastItems, topK);
      } else {
        if (!kauflandLastItems || !kauflandLastItems.length) {
          showMsg("Nejdřív načti strom kategorií Kaufland.", "error");
          return;
        }
        candidates = pickTopCandidatesForProduct(product, kauflandLastItems, topK);
      }

      const MAX_AI_ATTEMPTS = 3;
      let lastError = null;

      for (let attempt = 1; attempt <= MAX_AI_ATTEMPTS; attempt++) {
        try {
          const response = await fetch(apiUrl("aiMatchCategory"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              apiKey,
              provider,
              model,
              marketplace: marketplace,
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
            const status = response.status;
            const err = new Error("HTTP " + status + ": " + raw.slice(0, 400));
            lastError = err;

            // Retry on transient errors.
            const retryable = status === 429 || status >= 500;
            if (retryable && attempt < MAX_AI_ATTEMPTS) {
              const backoff = 700 * Math.pow(2, attempt - 1);
              await sleep(backoff + Math.floor(Math.random() * 250));
              continue;
            }
            throw err;
          }

          const data = await response.json();
          const chosenPath = data && data.categoryPath ? data.categoryPath : null;
          const chosenId = data && data.categoryId ? String(data.categoryId) : null;

          if (resultEl) {
            if (chosenPath) resultEl.textContent = chosenPath;
            else resultEl.textContent = "—";
          }
          if (resultIdEl) resultIdEl.textContent = chosenId || "—";

          product.estimatedCategoryId = chosenId || "";
          product.estimatedCategoryPath = chosenPath || "";

          // Cache successful estimate to avoid re-calling the LLM.
          if (chosenId) {
            writeCachedAiEstimate(product.id, extraFieldKey, {
              categoryId: chosenId,
              categoryPath: chosenPath || "",
            });
          }

          return;
        } catch (error) {
          lastError = error;
          if (attempt >= MAX_AI_ATTEMPTS) break;
          // continue loop to retry (if retryable, it was already handled above)
        }
      }

      throw lastError || new Error("AI chyba: neznámá chyba");
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
  const ALLEGRO_CLIENT_KEY_STORAGE = "allegro_client_key_local";
  const ALLEGRO_SECRET_KEY_STORAGE = "allegro_secret_key_local";
  const ALLEGRO_ACCEPT_LANGUAGE_STORAGE = "allegro_accept_language_local";
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

  const allegroClientKeyInput = document.getElementById("allegroClientKey");
  const allegroSecretKeyInput = document.getElementById("allegroSecretKey");
  const allegroAcceptLanguageSelect = document.getElementById("allegroAcceptLanguage");
  const btnLoadAllegroCategories = document.getElementById("btnLoadAllegroCategories");
  const allegroCategoriesOutput = document.getElementById("allegroCategoriesOutput");
  const allegroCategoriesCount = document.getElementById("allegroCategoriesCount");
  const btnSaveAllegroTree = document.getElementById("btnSaveAllegroTree");
  const btnDownloadAllegroTree = document.getElementById("btnDownloadAllegroTree");
  const btnLoadSavedAllegroTree = document.getElementById("btnLoadSavedAllegroTree");
  const btnClearSavedAllegroTree = document.getElementById("btnClearSavedAllegroTree");

  const KAUFLAND_TREE_ITEMS_STORAGE_KEY = "kaufland_categories_tree_items_v1";
  let kauflandLastItems = [];
  let kauflandRootPath = null;
  let kauflandCategoryTokenCache = new Map();

  const ALLEGRO_TREE_ITEMS_STORAGE_KEY = "allegro_categories_tree_items_v1";
  let allegroLastItems = [];
  let allegroCategoryTokenCache = new Map();

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

  function getAllegroClientKey() {
    return (allegroClientKeyInput && (allegroClientKeyInput.value || "")).trim();
  }

  function getAllegroSecretKey() {
    return (allegroSecretKeyInput && (allegroSecretKeyInput.value || "")).trim();
  }

  function getAllegroAcceptLanguage() {
    const raw = allegroAcceptLanguageSelect ? (allegroAcceptLanguageSelect.value || "") : "cs-CZ";
    const lang = String(raw).trim();
    return lang || "cs-CZ";
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

  function renderAllegroCategoriesFromItems(items) {
    if (!allegroCategoriesOutput) return;
    const safeItems = Array.isArray(items) ? items : [];

    const toFullPath = (item) => {
      if (!item || typeof item.path !== "string") return null;
      const rel = item.path.trim();
      return rel ? "Všechny kategorie/" + rel : "Všechny kategorie";
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

    allegroCategoriesOutput.textContent = lines.map((l) => `${l.fullPath} (ID: ${l.id})`).join("\n");
    allegroCategoriesOutput.classList.remove("hidden");

    if (allegroCategoriesCount) {
      allegroCategoriesCount.textContent = "Celkem kategorií: " + lines.length;
      allegroCategoriesCount.classList.remove("hidden");
    }

    allegroLastItems = safeItems;
    allegroCategoryTokenCache = new Map();

    const has = allegroLastItems.length > 0;
    if (btnSaveAllegroTree) btnSaveAllegroTree.disabled = !has;
    if (btnDownloadAllegroTree) btnDownloadAllegroTree.disabled = !has;
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

  function clearAllegroCategoriesOutput() {
    if (!allegroCategoriesOutput) return;
    allegroCategoriesOutput.textContent = "";
    allegroCategoriesOutput.classList.add("hidden");
    if (allegroCategoriesCount) {
      allegroCategoriesCount.textContent = "Celkem kategorií: 0";
      allegroCategoriesCount.classList.add("hidden");
    }
    allegroLastItems = [];

    if (btnSaveAllegroTree) btnSaveAllegroTree.disabled = true;
    if (btnDownloadAllegroTree) btnDownloadAllegroTree.disabled = true;
  }

  async function loadAllegroCategoriesTree() {
    if (!btnLoadAllegroCategories || !allegroCategoriesOutput) return;

    const clientKey = getAllegroClientKey();
    const secretKey = getAllegroSecretKey();
    const acceptLanguage = getAllegroAcceptLanguage();

    let retryCount = 0;

    if (!clientKey) {
      showMsg("Zadejte Allegro client key.", "error");
      return;
    }
    if (!secretKey) {
      showMsg("Zadejte Allegro secret key.", "error");
      return;
    }

    btnLoadAllegroCategories.disabled = true;
    if (btnSaveAllegroTree) btnSaveAllegroTree.disabled = true;
    if (btnDownloadAllegroTree) btnDownloadAllegroTree.disabled = true;

    showMsg("Načítám strom kategorií Allegro...", "info");
    allegroCategoriesOutput.classList.add("hidden");
    allegroCategoriesOutput.textContent = "";
    if (allegroCategoriesCount) {
      allegroCategoriesCount.textContent = "Celkem kategorií: 0";
      allegroCategoriesCount.classList.add("hidden");
    }

    try {
      let state = null;
      let allItems = [];

      while (true) {
        showMsg("Načítám další dávku kategorií Allegro...", "info");

        const response = await fetch(apiUrl("allegroCategories"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            clientKey: clientKey,
            secretKey: secretKey,
            acceptLanguage: acceptLanguage,
            state: state,
          }),
        });

        if (!response.ok) {
          const raw = await response.text();
          const rawText = String(raw || "");
          const timeoutLike = /TimeoutError|timed out|Task timed out/i.test(rawText);
          if (timeoutLike && retryCount < 5) {
            retryCount++;
            showMsg(
              "Timeout při načítání Allegro, zkouším znovu (" + retryCount + "/5).",
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
        renderAllegroCategoriesFromItems(allItems);

        const truncated = !!data.truncated;
        retryCount = 0;
        showMsg(
          "Načteno " + allItems.length + " kategorií (Allegro)." + (truncated ? " Pokračuju..." : ""),
          "success"
        );

        if (!truncated) break;

        await new Promise((resolve) => setTimeout(resolve, 250));
      }

      // Cache the completed tree in localStorage so a refresh doesn't require re-downloading.
      try {
        localStorage.setItem(ALLEGRO_TREE_ITEMS_STORAGE_KEY, JSON.stringify(allItems));
      } catch {
        // ignore storage quota issues
      }
    } catch (error) {
      const msg = error && error.message ? error.message : String(error);
      showMsg("Chyba: " + msg, "error");
    } finally {
      btnLoadAllegroCategories.disabled = false;
    }
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

  if (btnLoadAllegroCategories) {
    btnLoadAllegroCategories.addEventListener("click", loadAllegroCategoriesTree);
  }

  if (btnSaveAllegroTree) {
    btnSaveAllegroTree.addEventListener("click", function () {
      try {
        if (!allegroLastItems || !allegroLastItems.length) {
          showMsg("Není co uložit (strom nebyl načten).", "error");
          return;
        }
        localStorage.setItem(ALLEGRO_TREE_ITEMS_STORAGE_KEY, JSON.stringify(allegroLastItems));
        showMsg("Strom kategorií Allegro uložen do prohlížeče.", "success");
      } catch (e) {
        showMsg("Chyba při ukládání: " + (e && e.message ? e.message : String(e)), "error");
      }
    });
  }

  if (btnDownloadAllegroTree) {
    btnDownloadAllegroTree.addEventListener("click", function () {
      try {
        const items =
          allegroLastItems && allegroLastItems.length
            ? allegroLastItems
            : (() => {
                const raw = localStorage.getItem(ALLEGRO_TREE_ITEMS_STORAGE_KEY);
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
        a.download = "allegro-categories-tree.json";
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      } catch (e) {
        showMsg("Chyba při stahování: " + (e && e.message ? e.message : String(e)), "error");
      }
    });
  }

  if (btnLoadSavedAllegroTree) {
    btnLoadSavedAllegroTree.addEventListener("click", function () {
      try {
        const raw = localStorage.getItem(ALLEGRO_TREE_ITEMS_STORAGE_KEY);
        if (!raw) {
          showMsg("V prohlížeči není uložený strom kategorií Allegro.", "error");
          return;
        }
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed) || !parsed.length) {
          showMsg("Uložený strom Allegro je prázdný.", "error");
          return;
        }
        renderAllegroCategoriesFromItems(parsed);
        showMsg("Načteno uložených kategorií Allegro: " + parsed.length + ".", "success");
      } catch (e) {
        showMsg("Chyba při načítání uloženého stromu Allegro: " + (e && e.message ? e.message : String(e)), "error");
      }
    });
  }

  if (btnClearSavedAllegroTree) {
    btnClearSavedAllegroTree.addEventListener("click", function () {
      try {
        localStorage.removeItem(ALLEGRO_TREE_ITEMS_STORAGE_KEY);
        clearAllegroCategoriesOutput();
        clearBaseLinkerAddLog();
        showMsg("Uložený strom Allegro byl vymazán.", "success");
      } catch (e) {
        showMsg("Chyba při mazání: " + (e && e.message ? e.message : String(e)), "error");
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

  try {
    const raw = localStorage.getItem(ALLEGRO_TREE_ITEMS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length) {
        renderAllegroCategoriesFromItems(parsed);
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

  if (allegroClientKeyInput) {
    const savedAllegroClientKey = localStorage.getItem(ALLEGRO_CLIENT_KEY_STORAGE);
    if (savedAllegroClientKey) allegroClientKeyInput.value = savedAllegroClientKey;

    allegroClientKeyInput.addEventListener("change", function () {
      localStorage.setItem(ALLEGRO_CLIENT_KEY_STORAGE, allegroClientKeyInput.value || "");
    });
  }

  if (allegroSecretKeyInput) {
    const savedAllegroSecretKey = localStorage.getItem(ALLEGRO_SECRET_KEY_STORAGE);
    if (savedAllegroSecretKey) allegroSecretKeyInput.value = savedAllegroSecretKey;

    allegroSecretKeyInput.addEventListener("change", function () {
      localStorage.setItem(ALLEGRO_SECRET_KEY_STORAGE, allegroSecretKeyInput.value || "");
    });
  }

  if (allegroAcceptLanguageSelect) {
    const savedAllegroAcceptLanguage = localStorage.getItem(ALLEGRO_ACCEPT_LANGUAGE_STORAGE);
    if (savedAllegroAcceptLanguage) allegroAcceptLanguageSelect.value = savedAllegroAcceptLanguage;

    allegroAcceptLanguageSelect.addEventListener("change", function () {
      localStorage.setItem(ALLEGRO_ACCEPT_LANGUAGE_STORAGE, allegroAcceptLanguageSelect.value || "");
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
    if (btnLoadAll) btnLoadAll.disabled = !tokenPresent;
    if (!tokenPresent) {
      if (btnPrevPage) btnPrevPage.disabled = true;
      if (btnNextPage) btnNextPage.disabled = true;
    }
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
