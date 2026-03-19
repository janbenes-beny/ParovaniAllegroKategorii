(function () {
  const TOKEN_STORAGE = "bl_token_local";
  const INVENTORY_STORAGE = "bl_inventory_local";

  const btnLoad = document.getElementById("btnLoad");
  const msgEl = document.getElementById("msg");
  const tableWrap = document.getElementById("tableWrap");
  const tbody = document.getElementById("productsTbody");
  const tokenInput = document.getElementById("apiToken");
  const inventoryInput = document.getElementById("inventoryId");

  function showMsg(text, type) {
    msgEl.textContent = text || "";
    msgEl.className = "msg " + (type || "");
    msgEl.classList.toggle("hidden", !text);
  }

  function getToken() {
    return (tokenInput.value || "").trim();
  }

  function getInventoryId() {
    return parseInt((inventoryInput.value || "").trim(), 10);
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

  async function fetchAllProductIds(inventoryId) {
    const ids = [];
    let page = 1;
    const apiPageSize = 1000;

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

      if (keys.length < apiPageSize) break;
      page += 1;
    }

    return ids;
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
        '<td><div class="desc">' + escapeHtml(row.description || "—") + "</div></td>";

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
      const productIds = await fetchAllProductIds(inventoryId);
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
        });
      });

      renderRows(rows);
      tableWrap.classList.remove("hidden");
      showMsg("Načteno " + rows.length + " produktů.", "success");
    } catch (error) {
      showMsg("Chyba: " + (error.message || String(error)), "error");
    } finally {
      btnLoad.disabled = false;
    }
  }

  btnLoad.addEventListener("click", loadProducts);

  const savedToken = sessionStorage.getItem(TOKEN_STORAGE);
  const savedInventory = sessionStorage.getItem(INVENTORY_STORAGE);
  if (savedToken) tokenInput.value = savedToken;
  if (savedInventory) inventoryInput.value = savedInventory;

  tokenInput.addEventListener("change", function () {
    sessionStorage.setItem(TOKEN_STORAGE, tokenInput.value || "");
  });
  inventoryInput.addEventListener("change", function () {
    sessionStorage.setItem(INVENTORY_STORAGE, inventoryInput.value || "");
  });
})();
