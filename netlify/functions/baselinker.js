const BASELINKER_URL = "https://api.baselinker.com/connector.php";

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

  const { token, method, parameters } = body;
  if (!token || !method) {
    return {
      statusCode: 400,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Chybi token nebo method" }),
    };
  }

  const serializedParameters =
    parameters != null
      ? typeof parameters === "string"
        ? parameters
        : JSON.stringify(parameters)
      : "{}";

  const form = new URLSearchParams();
  form.set("method", method);
  form.set("parameters", serializedParameters);

  try {
    const response = await fetch(BASELINKER_URL, {
      method: "POST",
      headers: {
        "X-BLToken": token,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
    });

    const raw = await response.text();
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      return {
        statusCode: 502,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          error: "Neplatna odpoved z BaseLinker API",
          raw: raw.slice(0, 500),
        }),
      };
    }

    return {
      statusCode: response.ok ? 200 : 502,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    };
  } catch (error) {
    return {
      statusCode: 502,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        error: "Chyba pripojeni k BaseLinker: " + (error.message || "neznama"),
      }),
    };
  }
};
