const cheerio = require("cheerio");

const FMCSA_URL = "https://safer.fmcsa.dot.gov/query.asp";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// ── Parse a single FMCSA snapshot page ──

function parseSnapshot(mcNumber, html) {
  const $ = cheerio.load(html);
  const bodyText = $("body").text().toLowerCase();

  // No record indicators
  const noRecord = [
    "no record",
    "no active",
    "could not find",
    "invalid",
    "no carrier",
    "record not found",
    "no match",
  ];

  if (noRecord.some((p) => bodyText.includes(p))) {
    return { mc: mcNumber, found: false, data: null };
  }

  // Helper to extract a field value by its label text
  function findField(label) {
    let value = "";
    const labelLower = label.toLowerCase();

    $("th, td, font, b").each((_i, el) => {
      const cellText = $(el).text().trim().replace(/\s+/g, " ");
      if (cellText.toLowerCase().includes(labelLower)) {
        // Try next sibling td
        const next = $(el).next("td");
        if (next.length) {
          value = next.text().trim().replace(/\s+/g, " ");
          return false; // break
        }
        // Try parent row
        const row = $(el).closest("tr");
        if (row.length) {
          const cells = row.find("td");
          cells.each((ci, c) => {
            const ct = $(c).text().trim().replace(/\s+/g, " ");
            if (ct.toLowerCase().includes(labelLower)) {
              const nextCell = cells.eq(ci + 1);
              if (nextCell.length) {
                value = nextCell.text().trim().replace(/\s+/g, " ");
                return false;
              }
            }
          });
          if (value) return false;
        }
      }
    });

    return value;
  }

  const data = {
    entity_type: findField("Entity Type:"),
    usdot_status: findField("USDOT Status:"),
    usdot_number: findField("USDOT Number:"),
    out_of_service_date: findField("Out of Service Date:"),
    operating_authority_status: findField("Operating Authority Status:"),
    mc_number: findField("MC/MX/FF Number"),
    legal_name: findField("Legal Name:"),
    dba_name: findField("DBA Name:"),
    physical_address: findField("Physical Address:"),
    phone: findField("Phone:"),
    mailing_address: findField("Mailing Address:"),
    power_units: findField("Power Units:"),
    mcs150_mileage: findField("MCS-150 Mileage"),
    mcs150_form_date: findField("MCS-150 Form Date:"),
    state_carrier_id: findField("State Carrier ID Number:"),
  };

  const isCarrier = data.entity_type.toUpperCase().includes("CARRIER");
  const isActive = data.usdot_status.toUpperCase().includes("ACTIVE");

  return {
    mc: mcNumber,
    found: isCarrier && isActive,
    isCarrier,
    isActive,
    data,
  };
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
        "Accept-Language": "en-US,en;q=0.5",
        Referer: "https://safer.fmcsa.dot.gov/CompanySnapshot.aspx",
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
