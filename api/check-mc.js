const cheerio = require("cheerio");

const FMCSA_URL = "https://safer.fmcsa.dot.gov/query.asp";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36";

// ============================================================
// Robust FMCSA SAFER HTML parser
// ============================================================
// The FMCSA snapshot page uses deeply nested tables. Labels like
// "Entity Type:" appear in BOTH the explanatory header AND the
// actual data rows. To avoid grabbing the wrong one, we use a
// two phase approach:
//   1. Find the real data section (the table containing
//      "USDOT INFORMATION" header).
//   2. Walk <tr> rows in that section, matching label <td>
//      to value <td> pairs.
// ============================================================

function parseSnapshot(mcNumber, html) {
  const $ = cheerio.load(html);
  const bodyText = $("body").text().toLowerCase();

  // Check for no record / invalid
  const noRecord = [
    "no record",
    "could not find",
    "invalid",
    "record not found",
    "no match",
    "error processing",
  ];

  if (noRecord.some((p) => bodyText.includes(p))) {
    return { mc: mcNumber, found: false, data: null };
  }

  // ── Strategy: find all <tr> rows that have exactly a label
  //    cell and a value cell, build a key/value map from their
  //    text content. The real data rows have bold (<b> or <a>)
  //    labels like "Entity Type:" followed by the value.
  // ──

  const fieldMap = {};

  $("tr").each((_i, row) => {
    const cells = $(row).children("td");
    if (cells.length < 2) return;

    // Walk cells in pairs: cell N = label, cell N+1 = value
    for (let c = 0; c < cells.length - 1; c++) {
      const labelCell = cells.eq(c);
      let labelText = "";

      // The label is usually inside a <b>, <a>, or <th> tag
      const bold = labelCell.find("b, a, th").first();
      if (bold.length) {
        labelText = bold.text().trim().replace(/\s+/g, " ");
      } else {
        labelText = labelCell.text().trim().replace(/\s+/g, " ");
      }

      // Must end with ":" or contain specific known label patterns
      if (!labelText || !labelText.includes(":")) continue;

      // Skip very long strings (explanatory paragraphs, not labels)
      if (labelText.length > 60) continue;

      const valueCell = cells.eq(c + 1);
      const valueText = valueCell.text().trim().replace(/\s+/g, " ");

      // Normalize label for our map key
      const key = labelText.replace(/:$/, "").trim();

      // Only store if we dont already have it (first occurrence wins,
      // which is the data section before the explanation sections)
      if (!fieldMap[key] && valueText && valueText.length < 500) {
        fieldMap[key] = valueText;
      }

      c++; // skip the value cell on next iteration
    }
  });

  // ── Map extracted fields to our structured output ──

  function getField(...possibleKeys) {
    for (const k of possibleKeys) {
      const kLower = k.toLowerCase();
      for (const [mapKey, mapVal] of Object.entries(fieldMap)) {
        if (mapKey.toLowerCase().includes(kLower)) {
          return mapVal;
        }
      }
    }
    return "";
  }

  const data = {
    entity_type: getField("Entity Type"),
    usdot_status: getField("USDOT Status"),
    usdot_number: getField("USDOT Number"),
    out_of_service_date: getField("Out of Service Date"),
    operating_authority_status: getField("Operating Authority Status"),
    mc_number: getField("MC/MX/FF Number"),
    legal_name: getField("Legal Name"),
    dba_name: getField("DBA Name"),
    physical_address: getField("Physical Address"),
    phone: getField("Phone"),
    mailing_address: getField("Mailing Address"),
    power_units: getField("Power Units"),
    mcs150_mileage: getField("MCS-150 Mileage"),
    mcs150_form_date: getField("MCS-150 Form Date"),
    state_carrier_id: getField("State Carrier ID"),
  };

  // If none of the critical fields found, try regex fallback
  if (!data.entity_type && !data.legal_name) {
    applyRegexFallback($, data, mcNumber);
  }

  // Set MC number if not found from page
  if (!data.mc_number) {
    data.mc_number = "MC-" + mcNumber;
  }

  const entityUpper = data.entity_type.toUpperCase();
  const statusUpper = data.usdot_status.toUpperCase();
  const authorityUpper = data.operating_authority_status.toUpperCase();

  const isCarrier = entityUpper.includes("CARRIER");
  const isActive = statusUpper.includes("ACTIVE") && !statusUpper.includes("INACTIVE");
  const isAuthorized = authorityUpper.includes("AUTHORIZED") && !authorityUpper.startsWith("NOT");

  return {
    mc: mcNumber,
    found: isCarrier && isActive && isAuthorized,
    isCarrier,
    isActive,
    isAuthorized,
    data,
  };
}

// ── Regex fallback for difficult pages ──

function applyRegexFallback($, data, mcNumber) {
  const text = $("body").text().replace(/\s+/g, " ");

  const patterns = {
    entity_type: /Entity Type:\s*(CARRIER|BROKER)/i,
    usdot_status: /USDOT Status:\s*(ACTIVE|INACTIVE|OUT[- ]OF[- ]SERVICE)/i,
    usdot_number: /USDOT Number:\s*(\d+)/i,
    out_of_service_date: /Out of Service Date:\s*([A-Za-z0-9/\- ]+?)(?=\s+USDOT|\s+State)/i,
    operating_authority_status: /Operating Authority Status:\s*((?:AUTHORIZED|NOT AUTHORIZED|OUT[- ]OF[- ]SERVICE)[^\n]*?)(?=\s+(?:\*Please|For Licensing))/i,
    mc_number: /MC\/MX\/FF Number\(s\):\s*(MC-\d+)/i,
    legal_name: /Legal Name:\s*([A-Z0-9 .,'&()/-]+?)(?=\s+DBA Name)/i,
    dba_name: /DBA Name:\s*([A-Z0-9 .,'&()/-]*?)(?=\s+Physical Address)/i,
    physical_address: /Physical Address:\s*(.+?)(?=\s+Phone:)/i,
    phone: /Phone:\s*\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/i,
    mailing_address: /Mailing Address:\s*(.+?)(?=\s+DUNS Number)/i,
    power_units: /Power Units:\s*(\d+)/i,
    mcs150_form_date: /MCS-150 Form Date:\s*([\d/]+)/i,
    mcs150_mileage: /MCS-150 Mileage \(Year\):\s*([^\s]+(?:\s+\(\d{4}\))?)/i,
  };

  for (const [key, regex] of Object.entries(patterns)) {
    if (!data[key]) {
      const match = text.match(regex);
      if (match) {
        data[key] = match[key === "phone" ? 0 : 1].trim();
        // Remove the "Phone:" prefix if present
        if (key === "phone") {
          data[key] = data[key].replace(/^Phone:\s*/, "");
        }
      }
    }
  }
}

// ── Query FMCSA for a single MC number ──

async function checkSingleMC(mcNumber) {
  const params = new URLSearchParams({
    searchtype: "ANY",
    query_type: "queryCarrierSnapshot",
    query_param: "MC_MX",
    query_string: String(mcNumber),
  });

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const response = await fetch(FMCSA_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": USER_AGENT,
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        Referer: "https://safer.fmcsa.dot.gov/",
        Origin: "https://safer.fmcsa.dot.gov",
      },
      body: params.toString(),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      return { mc: mcNumber, found: false, error: `HTTP ${response.status}` };
    }

    const html = await response.text();
    return parseSnapshot(mcNumber, html);
  } catch (error) {
    return {
      mc: mcNumber,
      found: false,
      error: error.name === "AbortError" ? "Timeout" : error.message,
    };
  }
}

// ── Serverless handler ──

module.exports = async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { mc, start, count = "1", test } = req.query;

  // Connection test mode
  if (test === "true") {
    try {
      const resp = await fetch(
        "https://safer.fmcsa.dot.gov/CompanySnapshot.aspx",
        {
          method: "GET",
          headers: { "User-Agent": USER_AGENT },
          signal: AbortSignal.timeout(6000),
        },
      );
      return res.status(200).json({
        connected: resp.ok,
        status: resp.status,
        message: resp.ok
          ? "Successfully connected to FMCSA SAFER"
          : `FMCSA returned status ${resp.status}`,
      });
    } catch (err) {
      return res.status(200).json({
        connected: false,
        message: `Cannot reach FMCSA: ${err.message}`,
      });
    }
  }

  // Build list of MC numbers to check
  let mcNumbers = [];

  if (mc) {
    mcNumbers = [parseInt(mc, 10)];
  } else if (start) {
    const s = parseInt(start, 10);
    const c = Math.min(Math.max(parseInt(count, 10) || 1, 1), 10);
    mcNumbers = Array.from({ length: c }, (_, i) => s + i);
  } else {
    return res.status(400).json({
      error: "Provide ?mc=NUMBER or ?start=NUMBER&count=N or ?test=true",
    });
  }

  // Validate
  if (mcNumbers.some((n) => isNaN(n) || n < 1)) {
    return res.status(400).json({ error: "Invalid MC number(s)" });
  }

  try {
    const settled = await Promise.allSettled(
      mcNumbers.map((n) => checkSingleMC(n)),
    );

    const results = settled.map((r) => {
      if (r.status === "fulfilled") return r.value;
      return {
        mc: null,
        found: false,
        error: r.reason?.message || "Unknown error",
      };
    });

    return res.status(200).json({ results });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};
