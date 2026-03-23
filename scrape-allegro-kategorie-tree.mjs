import { chromium } from "playwright";
import fs from "node:fs";

const startUrl = process.argv[2] || "https://allegro.cz/mapa-stranek/kategorie";
const outFile = process.argv[3] || "categories-tree.json";

function isCategoryHref(href) {
  return typeof href === "string" && /\/(kategorie|kategoria)\/\d+/i.test(href);
}

function idFromHref(href) {
  const m = href.match(/\/(kategorie|kategoria)\/(\d+)/i);
  return m ? m[2] : null;
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ userAgent: "Mozilla/5.0" });

  await page.goto(startUrl, { waitUntil: "domcontentloaded" });

  // Nekonečný scroll / lazy-load: scrollujeme, dokud se počet linků na kategorie už nezvyšuje.
  let lastCount = -1;
  let stableIterations = 0;
  for (let i = 0; i < 20; i++) {
    await page.evaluate(() => window.scrollBy(0, Math.floor(window.innerHeight * 0.9)));
    await page.waitForTimeout(1000);

    const count = await page.$$eval("a[href]", (as) => {
      let c = 0;
      for (const a of as) {
        const href = a.getAttribute("href") || "";
        if (/\/(kategorie|kategoria)\/\d+/i.test(href) || /\/(kategorie|kategoria)\/\d+/i.test(a.href || "")) {
          c += 1;
        }
      }
      return c;
    });

    if (count === lastCount && count > 0) stableIterations += 1;
    else stableIterations = 0;
    lastCount = count;

    if (stableIterations >= 2) break;
  }

  const tree = await page.evaluate(() => {
    const CATEGORY_RE = /\/(kategorie|kategoria)\/\d+/i;

    function normalizeHref(a) {
      return a?.href || a?.getAttribute?.("href") || "";
    }

    function isCategoryLink(el) {
      if (!el) return false;
      const href = normalizeHref(el);
      return CATEGORY_RE.test(href);
    }

    function textOf(el) {
      if (!el) return "";
      return (el.textContent || "").replace(/\s+/g, " ").trim();
    }

    function parseList(ul) {
      if (!ul) return [];
      const lis = Array.from(ul.children).filter((n) => n && n.tagName === "LI");

      const byHref = new Map(); // url -> node
      const resultInOrder = [];

      for (const li of lis) {
        // Pokus o název/URL jako přímý potomek (typicky li > a)
        let a = null;
        const directA = Array.from(li.children).find((c) => c && c.tagName === "A");
        if (directA && isCategoryLink(directA)) a = directA;

        // Fallback: první odkaz v rámci li
        if (!a) {
          const firstLink = li.querySelector('a[href]');
          if (firstLink && isCategoryLink(firstLink)) a = firstLink;
        }

        // Děti mohou být ve vnořeném ul/ol
        const directLists = Array.from(li.children).filter(
          (c) => c && (c.tagName === "UL" || c.tagName === "OL")
        );

        const children = directLists.length ? directLists.flatMap((l) => parseList(l)) : [];

        if (!a) {
          // Pokud li neobsahuje přímo odkazy na kategorie, nepřidáváme uzel,
          // ale zanoříme děti na aktuální úroveň.
          for (const ch of children) {
            if (ch && ch.url) {
              const existing = byHref.get(ch.url);
              if (existing) existing.children = mergeChildren(existing.children, ch.children);
              else {
                byHref.set(ch.url, ch);
                resultInOrder.push(ch);
              }
            } else {
              resultInOrder.push(ch);
            }
          }
          continue;
        }

        const url = normalizeHref(a);
        const name = textOf(a);
        const node = { id: null, name: name || url, url, children };

        const existing = byHref.get(url);
        if (existing) {
          existing.children = mergeChildren(existing.children, node.children);
        } else {
          byHref.set(url, node);
          resultInOrder.push(node);
        }
      }

      return resultInOrder;
    }

    function mergeChildren(targetChildren, newChildren) {
      const map = new Map();
      for (const n of targetChildren || []) {
        if (n && n.url) map.set(n.url, n);
      }

      const order = Array.from(targetChildren || []);
      for (const n of newChildren || []) {
        if (!n || !n.url) continue;
        const existing = map.get(n.url);
        if (existing) {
          existing.children = mergeChildren(existing.children, n.children);
        } else {
          map.set(n.url, n);
          order.push(n);
        }
      }
      return order;
    }

    // Najdeme "nejlepší" kořenový seznam (ul/ol), který obsahuje nejvíc odkazů na kategorie.
    const uls = Array.from(document.querySelectorAll("ul,ol"));
    let best = null;
    let bestCount = 0;

    for (const ul of uls) {
      const links = Array.from(ul.querySelectorAll("a[href]"));
      let c = 0;
      for (const a of links) {
        const href = a.href || a.getAttribute("href") || "";
        if (CATEGORY_RE.test(href)) c += 1;
      }
      if (c > bestCount) {
        bestCount = c;
        best = ul;
      }
    }

    const tree = parseList(best);

    // Doplníme id z URL.
    function addIds(nodes) {
      for (const n of nodes) {
        if (n && n.url) {
          const m = n.url.match(/\/(kategorie|kategoria)\/(\d+)/i);
          n.id = m ? m[2] : null;
        }
        if (n && Array.isArray(n.children) && n.children.length) addIds(n.children);
      }
    }

    addIds(tree);
    return tree;
  });

  // Z bezpečnostních důvodů odfiltrujeme úplně prázdné uzly.
  const cleaned = Array.isArray(tree)
    ? tree.filter((n) => n && typeof n === "object" && (n.url || n.name))
    : [];

  fs.writeFileSync(outFile, JSON.stringify(cleaned, null, 2), "utf-8");
  await browser.close();
  console.log(`Wrote tree to ${outFile}. Roots: ${cleaned.length}`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

