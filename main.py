# ============================================================
# FMCSA MC Number Checker - Main Entry Point
# ============================================================
#
# This tool automates checking MC numbers on the FMCSA SAFER
# website (https://safer.fmcsa.dot.gov/CompanySnapshot.aspx).
#
# It iterates through a range of MC numbers, queries each one,
# and filters out only ACTIVE CARRIERS (not brokers).
#
# IMPORTANT: This website requires a VPN to access from
# certain countries. Make sure your VPN is connected before
# running this tool.
#
# Usage:
#   python main.py                          (uses defaults from config.py)
#   python main.py --start 1700001 --end 1700100
#   python main.py --start 1700001 --end 1800000 --workers 5
#   python main.py --resume                 (resume from last checkpoint)
#
# ============================================================

import os
import sys
import time
import argparse
from datetime import datetime, timedelta
from concurrent.futures import ThreadPoolExecutor, as_completed

try:
    from colorama import init, Fore, Style
    init(autoreset=True)
    HAS_COLOR = True
except ImportError:
    HAS_COLOR = False

import config
from config import (
    DEFAULT_MC_START,
    DEFAULT_MC_END,
    REQUIRED_ENTITY_TYPE,
    REQUIRED_STATUS,
    MAX_WORKERS,
    OUTPUT_DIR,
    OUTPUT_CSV,
    OUTPUT_EXCEL,
    PROGRESS_LOG,
)
from scraper import build_session, query_mc_number, parse_snapshot, is_authorized_carrier
from output_handler import (
    save_to_csv,
    save_to_excel,
    save_progress,
    load_progress,
    append_to_csv,
)


# ── Color helpers ──────────────────────────────────────────

def green(text):
    return f"{Fore.GREEN}{text}{Style.RESET_ALL}" if HAS_COLOR else text

def red(text):
    return f"{Fore.RED}{text}{Style.RESET_ALL}" if HAS_COLOR else text

def yellow(text):
    return f"{Fore.YELLOW}{text}{Style.RESET_ALL}" if HAS_COLOR else text

def cyan(text):
    return f"{Fore.CYAN}{text}{Style.RESET_ALL}" if HAS_COLOR else text

def magenta(text):
    return f"{Fore.MAGENTA}{text}{Style.RESET_ALL}" if HAS_COLOR else text


# ── Banner ─────────────────────────────────────────────────

def print_banner():
    banner = """
╔══════════════════════════════════════════════════════════════╗
║                                                              ║
║     ███████╗███╗   ███╗ ██████╗███████╗ █████╗               ║
║     ██╔════╝████╗ ████║██╔════╝██╔════╝██╔══██╗              ║
║     █████╗  ██╔████╔██║██║     ███████╗███████║              ║
║     ██╔══╝  ██║╚██╔╝██║██║     ╚════██║██╔══██║              ║
║     ██║     ██║ ╚═╝ ██║╚██████╗███████║██║  ██║              ║
║     ╚═╝     ╚═╝     ╚═╝ ╚═════╝╚══════╝╚═╝  ╚═╝              ║
║                                                              ║
║      MC Number Checker | Authorized Carrier Finder           ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
"""
    print(cyan(banner) if HAS_COLOR else banner)


# ── Single MC check ───────────────────────────────────────

def check_single_mc(session, mc_number, csv_path):
    """
    Check a single MC number and return result.
    Returns (mc_number, data) if authorized carrier, else None.
    """
    html = query_mc_number(session, mc_number)
    data = parse_snapshot(html)

    if data is None:
        return None

    if is_authorized_carrier(data, REQUIRED_ENTITY_TYPE, REQUIRED_STATUS):
        # Save immediately to CSV for real time results
        append_to_csv(mc_number, data, csv_path)
        return (mc_number, data)

    return None


# ── Sequential scanning ───────────────────────────────────

def scan_sequential(mc_start, mc_end, resume_from=None):
    """
    Scan MC numbers sequentially (safer, respects rate limits).
    """
    session = build_session()
    results = []
    total = mc_end - mc_start + 1
    checked = 0
    found = 0
    errors = 0
    start_time = datetime.now()

    csv_path = os.path.join(OUTPUT_DIR, OUTPUT_CSV)
    start_mc = resume_from if resume_from else mc_start

    print(f"\n  Scan Range:  MC-{mc_start} to MC-{mc_end}")
    print(f"  Total to Check:  {total:,}")
    if resume_from:
        print(f"  Resuming from:  MC-{resume_from}")
        skipped = resume_from - mc_start
        print(f"  Skipping:  {skipped:,} already checked")
    print(f"  Criteria:  Entity Type = {REQUIRED_ENTITY_TYPE}, Status = {REQUIRED_STATUS}")
    print(f"  Delay:  {config.DELAY_BETWEEN_REQUESTS}s between requests")
    print(f"  Output:  {csv_path}")
    print(f"\n  {'='*60}")
    print()

    for mc_number in range(start_mc, mc_end + 1):
        checked += 1
        progress_pct = (checked / total) * 100

        # Estimate time remaining
        elapsed = (datetime.now() - start_time).total_seconds()
        if checked > 1:
            avg_time = elapsed / (checked - 1)
            remaining = avg_time * (total - checked)
            eta = str(timedelta(seconds=int(remaining)))
        else:
            eta = "calculating..."

        sys.stdout.write(
            f"\r  [{progress_pct:5.1f}%] Checking MC-{mc_number} | "
            f"Found: {green(str(found))} | "
            f"Errors: {red(str(errors))} | "
            f"ETA: {eta}   "
        )
        sys.stdout.flush()

        try:
            result = check_single_mc(session, mc_number, csv_path)
            if result:
                found += 1
                mc_num, data = result
                results.append(result)
                print(
                    f"\n  {green('>>> FOUND!')} MC-{mc_num} | "
                    f"{data.get('legal_name', 'N/A')} | "
                    f"{data.get('entity_type', 'N/A')} | "
                    f"{data.get('usdot_status', 'N/A')}"
                )
        except Exception as e:
            errors += 1
            print(f"\n  {red('ERROR')} MC-{mc_number}: {str(e)}")

        # Save progress checkpoint
        save_progress(mc_number, OUTPUT_DIR, PROGRESS_LOG)

        # Delay between requests
        time.sleep(config.DELAY_BETWEEN_REQUESTS)

    return results, checked, found, errors


# ── Concurrent scanning ──────────────────────────────────

def scan_concurrent(mc_start, mc_end, max_workers, resume_from=None):
    """
    Scan MC numbers concurrently for faster processing.
    Use with caution to avoid rate limiting.
    """
    results = []
    total = mc_end - mc_start + 1
    checked = 0
    found = 0
    errors = 0
    start_time = datetime.now()

    csv_path = os.path.join(OUTPUT_DIR, OUTPUT_CSV)
    start_mc = resume_from if resume_from else mc_start

    print(f"\n  Scan Range:  MC-{mc_start} to MC-{mc_end}")
    print(f"  Total to Check:  {total:,}")
    print(f"  Workers:  {max_workers}")
    if resume_from:
        print(f"  Resuming from:  MC-{resume_from}")
    print(f"  Criteria:  Entity Type = {REQUIRED_ENTITY_TYPE}, Status = {REQUIRED_STATUS}")
    print(f"  Output:  {csv_path}")
    print(f"\n  {'='*60}")
    print()

    mc_numbers = list(range(start_mc, mc_end + 1))

    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        # Each worker gets its own session
        sessions = {i: build_session() for i in range(max_workers)}

        future_to_mc = {}
        for idx, mc_num in enumerate(mc_numbers):
            worker_id = idx % max_workers
            future = executor.submit(
                check_single_mc,
                sessions[worker_id],
                mc_num,
                csv_path,
            )
            future_to_mc[future] = mc_num

        for future in as_completed(future_to_mc):
            mc_num = future_to_mc[future]
            checked += 1
            progress_pct = (checked / total) * 100

            elapsed = (datetime.now() - start_time).total_seconds()
            if checked > 1:
                avg_time = elapsed / (checked - 1)
                remaining = avg_time * (total - checked)
                eta = str(timedelta(seconds=int(remaining)))
            else:
                eta = "calculating..."

            try:
                result = future.result()
                if result:
                    found += 1
                    mc_n, data = result
                    results.append(result)
                    print(
                        f"\n  {green('>>> FOUND!')} MC-{mc_n} | "
                        f"{data.get('legal_name', 'N/A')} | "
                        f"{data.get('entity_type', 'N/A')} | "
                        f"{data.get('usdot_status', 'N/A')}"
                    )
            except Exception as e:
                errors += 1
                print(f"\n  {red('ERROR')} MC-{mc_num}: {str(e)}")

            sys.stdout.write(
                f"\r  [{progress_pct:5.1f}%] Checked: {checked}/{total} | "
                f"Found: {green(str(found))} | "
                f"Errors: {red(str(errors))} | "
                f"ETA: {eta}   "
            )
            sys.stdout.flush()

            # Save progress
            save_progress(mc_num, OUTPUT_DIR, PROGRESS_LOG)

    return results, checked, found, errors


# ── Main ──────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="FMCSA SAFER MC Number Checker: Find Authorized Carriers",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python main.py --start 1700001 --end 1700100
  python main.py --start 1700001 --end 1800000 --workers 5
  python main.py --resume
  python main.py --start 1700001 --end 1700050 --delay 0.5
        """,
    )
    parser.add_argument(
        "--start", type=int, default=DEFAULT_MC_START,
        help=f"Starting MC number (default: {DEFAULT_MC_START})"
    )
    parser.add_argument(
        "--end", type=int, default=DEFAULT_MC_END,
        help=f"Ending MC number (default: {DEFAULT_MC_END})"
    )
    parser.add_argument(
        "--workers", type=int, default=1,
        help=f"Number of concurrent workers (default: 1, max: {MAX_WORKERS})"
    )
    parser.add_argument(
        "--delay", type=float, default=config.DELAY_BETWEEN_REQUESTS,
        help=f"Delay between requests in seconds (default: {config.DELAY_BETWEEN_REQUESTS})"
    )
    parser.add_argument(
        "--resume", action="store_true",
        help="Resume from last saved checkpoint"
    )
    parser.add_argument(
        "--output-dir", type=str, default=OUTPUT_DIR,
        help=f"Output directory (default: {OUTPUT_DIR})"
    )

    args = parser.parse_args()

    # Update delay if overridden via CLI
    config.DELAY_BETWEEN_REQUESTS = args.delay

    print_banner()

    # Check for resume
    resume_from = None
    if args.resume:
        last_checked = load_progress(args.output_dir, PROGRESS_LOG)
        if last_checked:
            resume_from = last_checked + 1
            print(f"  {yellow('Resuming')} from MC-{resume_from} (last checked: MC-{last_checked})")
        else:
            print(f"  {yellow('No checkpoint found.')} Starting from MC-{args.start}")

    print(f"\n  {cyan('VPN REMINDER:')} Make sure your VPN is connected!")
    print(f"  The FMCSA website may not be accessible without VPN.\n")

    start_time = datetime.now()

    # Run the scan
    workers = min(args.workers, MAX_WORKERS)
    if workers > 1:
        results, checked, found, errors = scan_concurrent(
            args.start, args.end, workers, resume_from
        )
    else:
        results, checked, found, errors = scan_sequential(
            args.start, args.end, resume_from
        )

    elapsed = datetime.now() - start_time

    # Print summary
    print(f"\n\n  {'='*60}")
    print(f"  {cyan('SCAN COMPLETE')}")
    print(f"  {'='*60}")
    print(f"  Total Checked:   {checked:,}")
    print(f"  Carriers Found:  {green(str(found))}")
    print(f"  Errors:          {red(str(errors))}")
    print(f"  Time Elapsed:    {str(elapsed).split('.')[0]}")
    print(f"  {'='*60}")

    # Save final results to Excel
    if results:
        excel_path = os.path.join(args.output_dir, OUTPUT_EXCEL)
        csv_path = os.path.join(args.output_dir, OUTPUT_CSV)

        # The CSV was already populated in real time
        print(f"\n  {green('Results saved:')}")
        print(f"    CSV:   {csv_path}")

        # Generate the Excel report
        save_to_excel(results, excel_path)
        print(f"    Excel: {excel_path}")
    else:
        print(f"\n  {yellow('No authorized carriers found in the scanned range.')}")

    print()


if __name__ == "__main__":
    main()
