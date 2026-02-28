# ============================================================
# FMCSA SAFER Company Snapshot Scraper
# ============================================================
# This module handles all interaction with the FMCSA SAFER
# website, sending POST requests and parsing HTML responses.
# ============================================================

import re
import time
import requests
from bs4 import BeautifulSoup
from config import (
    FMCSA_QUERY_URL,
    REQUEST_TIMEOUT,
    MAX_RETRIES,
    RETRY_DELAY,
    USER_AGENT,
)


def build_session():
    """
    Create a requests.Session with proper headers
    to mimic a real browser visit.
    """
    session = requests.Session()
    session.headers.update({
        "User-Agent": USER_AGENT,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
        "Accept-Encoding": "gzip, deflate, br",
        "Connection": "keep-alive",
        "Upgrade-Insecure-Requests": "1",
        "Referer": "https://safer.fmcsa.dot.gov/CompanySnapshot.aspx",
    })
    return session


def query_mc_number(session, mc_number):
    """
    Send a POST request to the FMCSA SAFER query endpoint
    for a specific MC number.

    Returns the raw HTML response text, or None on failure.
    """
    payload = {
        "searchtype": "ANY",
        "query_type": "queryCarrierSnapshot",
        "query_param": "MC_MX",
        "query_string": str(mc_number),
    }

    for attempt in range(1, MAX_RETRIES + 1):
        try:
            response = session.post(
                FMCSA_QUERY_URL,
                data=payload,
                timeout=REQUEST_TIMEOUT,
            )
            response.raise_for_status()
            return response.text

        except requests.exceptions.Timeout:
            print(f"    [Attempt {attempt}/{MAX_RETRIES}] Timeout for MC-{mc_number}")
        except requests.exceptions.ConnectionError:
            print(f"    [Attempt {attempt}/{MAX_RETRIES}] Connection error for MC-{mc_number}")
        except requests.exceptions.HTTPError as e:
            print(f"    [Attempt {attempt}/{MAX_RETRIES}] HTTP error for MC-{mc_number}: {e}")
        except requests.exceptions.RequestException as e:
            print(f"    [Attempt {attempt}/{MAX_RETRIES}] Request error for MC-{mc_number}: {e}")

        if attempt < MAX_RETRIES:
            time.sleep(RETRY_DELAY)

    return None


def _clean_text(text):
    """Remove extra whitespace and normalize a string."""
    if text is None:
        return ""
    return re.sub(r'\s+', ' ', text.strip())


def _extract_table_field(soup, label_text):
    """
    Find a table cell containing `label_text` and return
    the text of the next sibling cell(s).
    """
    # Look for the label in all <th> and <td> elements
    for cell in soup.find_all(["th", "td"]):
        cell_text = _clean_text(cell.get_text())
        if label_text.lower() in cell_text.lower():
            # Try the next sibling <td>
            next_td = cell.find_next_sibling("td")
            if next_td:
                return _clean_text(next_td.get_text())
            # If label is inside a <td>, try the next <td> in the row
            parent_row = cell.find_parent("tr")
            if parent_row:
                cells = parent_row.find_all("td")
                for i, c in enumerate(cells):
                    if label_text.lower() in _clean_text(c.get_text()).lower():
                        if i + 1 < len(cells):
                            return _clean_text(cells[i + 1].get_text())
    return ""


def parse_snapshot(html):
    """
    Parse the FMCSA Company Snapshot HTML response and extract
    all relevant carrier information.

    Returns a dictionary with the parsed fields, or None if
    the page indicates no record was found.
    """
    if html is None:
        return None

    soup = BeautifulSoup(html, "html.parser")
    page_text = soup.get_text()

    # Check if no record was found
    no_record_patterns = [
        "no record",
        "no active",
        "could not find",
        "invalid",
        "no carrier",
        "record not found",
    ]
    page_text_lower = page_text.lower()
    for pattern in no_record_patterns:
        if pattern in page_text_lower:
            return None

    # Extract all fields from the snapshot page
    data = {}

    # USDOT Information section
    data["entity_type"] = _extract_table_field(soup, "Entity Type:")
    data["usdot_status"] = _extract_table_field(soup, "USDOT Status:")
    data["usdot_number"] = _extract_table_field(soup, "USDOT Number:")
    data["out_of_service_date"] = _extract_table_field(soup, "Out of Service Date:")
    data["mcs150_form_date"] = _extract_table_field(soup, "MCS-150 Form Date:")
    data["mcs150_mileage"] = _extract_table_field(soup, "MCS-150 Mileage")

    # Operating Authority section
    data["operating_authority_status"] = _extract_table_field(soup, "Operating Authority Status:")

    # MC/MX/FF Number
    data["mc_mx_ff_number"] = _extract_table_field(soup, "MC/MX/FF Number")

    # Company Information section
    data["legal_name"] = _extract_table_field(soup, "Legal Name:")
    data["dba_name"] = _extract_table_field(soup, "DBA Name:")
    data["physical_address"] = _extract_table_field(soup, "Physical Address:")
    data["phone"] = _extract_table_field(soup, "Phone:")
    data["mailing_address"] = _extract_table_field(soup, "Mailing Address:")
    data["power_units"] = _extract_table_field(soup, "Power Units:")

    # Operation Classification
    operation_section = ""
    for cell in soup.find_all(["th", "td"]):
        if "operation classification" in _clean_text(cell.get_text()).lower():
            # Grab text from the surrounding area
            parent = cell.find_parent("table")
            if parent:
                operation_section = _clean_text(parent.get_text())
            break
    data["operation_classification"] = operation_section

    # Carrier Operation (Interstate/Intrastate)
    carrier_op_section = ""
    for cell in soup.find_all(["th", "td"]):
        if "carrier operation" in _clean_text(cell.get_text()).lower():
            parent = cell.find_parent("table")
            if parent:
                carrier_op_section = _clean_text(parent.get_text())
            break
    data["carrier_operation"] = carrier_op_section

    # Check for X marks in operation classification
    auth_for_hire = False
    for cell in soup.find_all(["td"]):
        ct = _clean_text(cell.get_text())
        if "auth. for hire" in ct.lower() or "authorized for hire" in ct.lower():
            # Check if there's an X mark nearby
            prev = cell.find_previous_sibling("td")
            if prev and "x" in _clean_text(prev.get_text()).lower():
                auth_for_hire = True
            break
    data["auth_for_hire"] = "Yes" if auth_for_hire else "No"

    return data


def is_authorized_carrier(data, required_entity_type, required_status):
    """
    Check if the parsed data meets the criteria:
    1. Entity Type is CARRIER (not BROKER)
    2. USDOT Status is ACTIVE

    Returns True if the carrier qualifies.
    """
    if data is None:
        return False

    entity_type = data.get("entity_type", "").upper().strip()
    status = data.get("usdot_status", "").upper().strip()

    is_carrier = required_entity_type.upper() in entity_type
    is_active = required_status.upper() in status

    return is_carrier and is_active
