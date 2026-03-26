const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";

function extractJsonObject(text) {
  const t = String(text || "").trim();
  if (!t) return null;

  const fenceMatch = t.match(/```json\s*([\s\S]*?)\s*```/i);
  if (fenceMatch && fenceMatch[1]) {
    try {
      return JSON.parse(fenceMatch[1]);
    } catch {
      // fall through
    }
  }

  const firstBrace = t.indexOf("{");
  const lastBrace = t.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    const maybe = t.slice(firstBrace, lastBrace + 1);
    try {
      return JSON.parse(maybe);
    } catch {
      return null;
    }
  }

  try {
    return JSON.parse(t);
  } catch {
    return null;
  }
}

function extractCategoryFromText(text) {
  const t = String(text || "");
  const idMatch = t.match(/"categoryId"\s*:\s*"?(\d+)"?/i);
  const confidenceMatch = t.match(/"confidence"\s*:\s*(0(?:\.\d+)?|1(?:\.0+)?|0?\.\d+)/i);

  if (!idMatch) return null;

  const out = {
    categoryId: String(idMatch[1]),
    confidence: confidenceMatch ? Number(confidenceMatch[1]) : null,
  };

  return out;
}

function buildUserPayload(product, candidates, inputMode) {
  return {
    inputMode,
    product: {
      heurekaCategoryName: product.heurekaCategoryName || "",
      title: product.title || "",
      description: product.description || "",
    },
    candidates: candidates.map((c) => ({
      id: c.id != null ? String(c.id) : "",
      path: String(c.path || ""),
      name: String(c.name || c.path || ""),
    })),
  };
}

function buildSystemPrompt() {
  return (
    "You are a helpful assistant that selects the best matching category from a provided candidate shortlist. " +
    "Choose the single best Kaufland category for the product based on semantics of the Heureka category, product title, and product description. " +
    "Return ONLY a single-line valid JSON object exactly in this shape: " +
    "{\"categoryId\":\"<candidate_id>\",\"confidence\":0.0} " +
    "Keys must be exactly: categoryId and confidence (0..1). " +
    "categoryId must be copied exactly from one of the candidates. " +
    "Do NOT wrap the JSON in markdown code fences and do NOT output any extra text."
  );
}

async function callOpenAi({ apiKey, model, systemPrompt, prompt }) {
  const usedModel = String(model || "gpt-4o-mini").trim() || "gpt-4o-mini";
  const res = await fetch(OPENAI_URL, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: usedModel,
      temperature: 0,
      max_tokens: 250,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: prompt },
      ],
    }),
  });

  const text = await res.text();
  if (!res.ok) {
    return {
      ok: false,
      error: "OpenAI error",
      status: res.status,
      raw: text.slice(0, 800),
    };
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return {
      ok: false,
      error: "Neplatna odpoved z OpenAI",
      status: 502,
      raw: text.slice(0, 800),
    };
  }

  const content =
    data &&
    data.choices &&
    data.choices[0] &&
    data.choices[0].message &&
    data.choices[0].message.content
      ? data.choices[0].message.content
      : "";

  return { ok: true, content };
}

async function callGemini({ apiKey, model, systemPrompt, prompt }) {
  const usedModel = String(model || "gemini-2.5-flash").trim() || "gemini-2.5-flash";
  const url = `${GEMINI_BASE_URL}/${encodeURIComponent(usedModel)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [{ text: systemPrompt + "\n\n" + prompt }],
        },
      ],
      generationConfig: {
        temperature: 0,
        // Short output contract (categoryId+confidence), but keep it safe.
        maxOutputTokens: 1200,
        responseMimeType: "application/json",
      },
    }),
  });

  const text = await res.text();
  if (!res.ok) {
    return {
      ok: false,
      error: "Gemini error",
      status: res.status,
      raw: text.slice(0, 800),
    };
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return {
      ok: false,
      error: "Neplatna odpoved z Gemini",
      status: 502,
      raw: text.slice(0, 800),
    };
  }

  const parts =
    data &&
    data.candidates &&
    data.candidates[0] &&
    data.candidates[0].content &&
    Array.isArray(data.candidates[0].content.parts)
      ? data.candidates[0].content.parts
      : [];

  const content = parts
    .map((p) => (p && typeof p.text === "string" ? p.text : ""))
    .join("\n")
    .trim();

  if (!content) {
    return {
      ok: false,
      error: "Gemini did not return text content",
      status: 502,
      raw: text.slice(0, 800),
    };
  }

  return { ok: true, content };
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

  const apiKey = String(body.apiKey || "").trim();
  const providerRaw = String(body.provider || "gemini").trim().toLowerCase();
  const provider = providerRaw === "openai" ? "openai" : providerRaw === "gemini" ? "gemini" : "";
  const model = String(body.model || "").trim();

  if (!apiKey) {
    return {
      statusCode: 400,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Chybi AI API key" }),
    };
  }

  if (!provider) {
    return {
      statusCode: 400,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Neplatny provider. Pouzijte 'openai' nebo 'gemini'." }),
    };
  }

  const product = body.product && typeof body.product === "object" ? body.product : {};
  const candidates = Array.isArray(body.candidates) ? body.candidates : [];
  const inputMode = body.inputMode || "text_only";

  if (!product || (!product.title && !product.description && !product.heurekaCategoryName)) {
    return {
      statusCode: 400,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Chybi vstup produktu" }),
    };
  }

  if (!candidates.length) {
    return {
      statusCode: 400,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Chybi kandidaty kategorií" }),
    };
  }

  const userPayload = buildUserPayload(product, candidates, inputMode);
  const systemPrompt = buildSystemPrompt();
  const prompt = JSON.stringify(userPayload);
  const candidateById = new Map();
  for (const c of candidates) {
    if (!c || c.id == null) continue;
    candidateById.set(String(c.id), c);
  }

  try {
    let llm =
      provider === "openai"
        ? await callOpenAi({ apiKey, model, systemPrompt, prompt })
        : await callGemini({ apiKey, model, systemPrompt, prompt });

    if (!llm.ok) {
      return {
        statusCode: 502,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          error: llm.error || "AI provider error",
          provider,
          status: llm.status || 502,
          raw: String(llm.raw || "").slice(0, 800),
        }),
      };
    }

    let parsed = extractJsonObject(llm.content);
    if (!parsed) parsed = extractCategoryFromText(llm.content);

    if (!parsed && provider === "gemini") {
      const retrySystemPrompt =
        "Return ONLY a single-line valid JSON object exactly in this shape: " +
        "{\"categoryId\":\"<candidate_id>\",\"confidence\":0.0} " +
        "Keys must be exactly: categoryId and confidence (0..1). No extra text.";
      llm = await callGemini({ apiKey, model, systemPrompt: retrySystemPrompt, prompt });
      if (!llm.ok) {
        return {
          statusCode: 502,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            error: llm.error || "Gemini error",
            provider,
            status: llm.status || 502,
            raw: String(llm.raw || "").slice(0, 800),
          }),
        };
      }
      parsed = extractJsonObject(llm.content);
      if (!parsed) parsed = extractCategoryFromText(llm.content);
    }

    if (!parsed || !parsed.categoryId) {
      return {
        statusCode: 502,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          error: provider === "gemini" ? "Gemini did not return JSON" : "OpenAI did not return JSON",
          provider,
          raw: String(llm.content || "").slice(0, 500),
        }),
      };
    }

    const chosenId = String(parsed.categoryId);
    const chosenCandidate = candidateById.get(chosenId);
    const categoryPath = chosenCandidate ? String(chosenCandidate.path || "") : null;
    const confidence = typeof parsed.confidence === "number" ? parsed.confidence : null;

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        categoryId: chosenId,
        categoryPath,
        confidence,
        reasonShort: null,
        provider,
      }),
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: error && error.message ? error.message : String(error) }),
    };
  }
};

