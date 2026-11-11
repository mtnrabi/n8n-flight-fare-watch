#!/usr/bin/env python3
"""Daily fare watch for GitHub Actions: one round-trip search, and a GitHub issue when the fare is a deal.

GitHub emails you about new issues in your own repo, so there is no SMTP or Slack to set up.

Settings (environment variables, set in the workflow file):
  FROM, TO            IATA codes, e.g. JFK, LIS
  DEPART              YYYY-MM-DD, or leave empty and set DAYS_AHEAD (default 45)
  NIGHTS              trip length (default 7)
  TARGET_PRICE        alert at or under this total (optional)
  CURRENCY            default usd
  RAPIDAPI_KEY        repository secret
  GITHUB_TOKEN        provided by Actions (needs `issues: write`)
Standard library only.
"""
from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
from datetime import date, datetime, timedelta, timezone
from typing import Callable, Optional

API_HOST = "google-flights-live-api.p.rapidapi.com"
URL = f"https://{API_HOST}/api/google_flights/roundtrip/v1"
SIGNUP_URL = "https://rapidapi.com/mtnrabi/api/google-flights-live-api"
ATTRIBUTION = {"_fp_source": "gh-example", "_fp_tool": "n8n-flight-fare-watch-action"}  # optional, removable


def settings(env=os.environ) -> dict:
    depart = env.get("DEPART", "").strip()
    if not depart:
        depart = (date.today() + timedelta(days=int(env.get("DAYS_AHEAD", "45") or 45))).isoformat()
    nights = int(env.get("NIGHTS", "7") or 7)
    target = env.get("TARGET_PRICE", "").strip()
    return {
        "from": env["FROM"].strip().upper(), "to": env["TO"].strip().upper(), "depart": depart,
        "return": (date.fromisoformat(depart) + timedelta(days=nights)).isoformat(),
        "target": float(target) if target else None, "currency": env.get("CURRENCY", "usd") or "usd",
    }


def body_for(s: dict) -> dict:
    return {"from_airport": s["from"], "to_airport": s["to"], "departure_date": s["depart"],
            "return_date": s["return"], "currency": s["currency"], "limit": 10, "sort_type": "Price", **ATTRIBUTION}


def search(body: dict, key: str) -> list:
    req = urllib.request.Request(URL, data=json.dumps(body).encode(), method="POST", headers={
        "Content-Type": "application/json", "x-rapidapi-key": key, "x-rapidapi-host": API_HOST,
        "User-Agent": "n8n-flight-fare-watch-action/1.0"})
    with urllib.request.urlopen(req, timeout=90) as r:
        return json.loads(r.read().decode())


def decide(rows: list, s: dict) -> tuple[Optional[dict], list[str]]:
    priced = [r for r in rows if isinstance(r.get("total_price_as_number"), (int, float))]
    if not priced:
        return None, []
    best = min(priced, key=lambda r: r["total_price_as_number"])
    p, why = best["total_price_as_number"], []
    if s["target"] is not None and p <= s["target"]:
        why.append(f"at or under your target of {s['target']:g}")
    low = best.get("price_insights_low")
    if isinstance(low, (int, float)) and p < low:
        why.append(f"under Google's usual range ({low}-{best.get('price_insights_high')})")
    if best.get("price_range_in_relation_to_other_periods") == "low":
        why.append("Google rates it LOW for these dates")
    return best, why


def report(best: dict, why: list[str], s: dict, fetched_at: str) -> tuple[str, str]:
    cur = s["currency"].upper()
    p = best["total_price_as_number"]
    title = f"Fare watch: {s['from']}-{s['to']} {best['departure_date']} {p:g} {cur}"
    lines = [
        f"**{s['from']} -> {s['to']}**, {best['departure_date']} to {best['return_date']}: **{p:g} {cur}** round trip",
        f"- Outbound: {best.get('departure_flight_airline')}, {best.get('departure_flight_stops')} stop(s), "
        f"{best.get('departure_flight_departure_description')}",
        f"- Return: {best.get('return_flight_airline')}, {best.get('return_flight_stops')} stop(s), "
        f"{best.get('return_flight_departure_description')}",
        f"- Google: {best.get('price_range_in_relation_to_other_periods')} "
        f"(usual {best.get('price_insights_low')}-{best.get('price_insights_high')} {cur})",
        f"- Why: {'; '.join(why)}" if why else "- No alert rule matched",
        f"- [Book on Google Flights]({best.get('buy_link')})",
        "", f"Fetched {fetched_at}. Fares change within minutes.",
    ]
    return title, "\n".join(lines)


def open_issue(title: str, body: str, repo: str, token: str) -> None:
    req = urllib.request.Request(f"https://api.github.com/repos/{repo}/issues", method="POST",
                                 data=json.dumps({"title": title, "body": body, "labels": ["fare-alert"]}).encode(),
                                 headers={"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json",
                                          "User-Agent": "n8n-flight-fare-watch-action"})
    urllib.request.urlopen(req, timeout=30).close()


def main(fetch: Optional[Callable[[dict], list]] = None, env=os.environ) -> int:
    s = settings(env)
    if fetch is None:
        key = env.get("RAPIDAPI_KEY", "")
        if not key:
            print(f"::error::Add a RAPIDAPI_KEY repository secret (free key: {SIGNUP_URL})")
            return 2
        fetch = lambda b: search(b, key)
    fetched_at = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    try:
        rows = fetch(body_for(s))
    except urllib.error.HTTPError as e:
        print(f"::warning::search did not complete (HTTP {e.code}); it will run again tomorrow")
        return 0 if e.code >= 500 else 1
    best, why = decide(rows, s)
    if best is None:
        print("No flights found for these dates.")
        return 0
    title, body = report(best, why, s, fetched_at)
    print(title)
    if env.get("GITHUB_STEP_SUMMARY"):
        with open(env["GITHUB_STEP_SUMMARY"], "a") as f:
            f.write(body + "\n")
    if why and env.get("GITHUB_TOKEN") and env.get("GITHUB_REPOSITORY"):
        open_issue(title, body, env["GITHUB_REPOSITORY"], env["GITHUB_TOKEN"])
        print("Opened an issue (GitHub emails you about it).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
