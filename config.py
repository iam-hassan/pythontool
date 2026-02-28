# ============================================================
# FMCSA MC Number Checker - Configuration
# ============================================================
# All configurable settings for the tool are defined here.
# Modify these values to customize the tool's behavior.
# ============================================================

# FMCSA SAFER API endpoint for company snapshot queries
FMCSA_QUERY_URL = "https://safer.fmcsa.dot.gov/query.asp"

# Default MC number range to scan
DEFAULT_MC_START = 1700001
DEFAULT_MC_END = 1700100

# Filtering criteria
# Entity Type must match one of these (case insensitive)
REQUIRED_ENTITY_TYPE = "CARRIER"

# USDOT Status must match this (case insensitive)
REQUIRED_STATUS = "ACTIVE"

# Request settings
REQUEST_TIMEOUT = 30          # seconds
DELAY_BETWEEN_REQUESTS = 1.0  # seconds (be respectful to the server)
MAX_RETRIES = 3               # number of retries on failure
RETRY_DELAY = 5               # seconds between retries

# Concurrency settings (use with caution to avoid rate limiting)
MAX_WORKERS = 3               # number of concurrent requests

# Output settings
OUTPUT_DIR = "output"
OUTPUT_CSV = "authorized_carriers.csv"
OUTPUT_EXCEL = "authorized_carriers.xlsx"
PROGRESS_LOG = "scan_progress.log"

# User Agent for requests
USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
