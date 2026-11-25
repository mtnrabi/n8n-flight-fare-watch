import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "github-action"))
import fare_watch as fw  # noqa: E402

ROWS = json.loads((ROOT / "recorded" / "JFK-LIS_2027-02-01_2027-02-08.json").read_text())
ENV = {"FROM": "jfk", "TO": "lis", "DEPART": "2027-02-01", "NIGHTS": "7", "CURRENCY": "usd"}


def test_settings_and_body():
    s = fw.settings(ENV)
    assert s["return"] == "2027-02-08"
    b = fw.body_for(s)
    assert b["from_airport"] == "JFK" and b["return_date"] == "2027-02-08"
    assert all(k == k.lower() for k in b)
    # either one drops Google's range and verdict from the answer
    assert "sort_type" not in b and "max_price" not in b


BAND = {"price_insights_low": 100, "price_insights_high": 200, "price_range_in_relation_to_other_periods": "low",
        "departure_date": "2027-02-01", "return_date": "2027-02-08"}


def test_range_and_verdict_alert_on_the_cheapest_row_even_when_it_is_not_first():
    rows = [dict(BAND, total_price_as_number=140), dict(BAND, total_price_as_number=90)]
    best, why = fw.decide(rows, dict(fw.settings(ENV), target=None))
    assert best["total_price_as_number"] == 90
    assert why == ["under Google's usual range (100-200)", "Google rates it LOW for these dates"]


def test_report_without_a_range_does_not_print_none():
    row = {"total_price_as_number": 90, "departure_date": "2027-02-01", "return_date": "2027-02-08",
           "price_insights_low": None, "price_insights_high": None, "price_range_in_relation_to_other_periods": ""}
    _, body = fw.report(row, ["test"], fw.settings(ENV), "T")
    assert "no usual range" in body and "usual None" not in body


def test_alert_on_real_response(tmp_path, monkeypatch):
    opened = []
    monkeypatch.setattr(fw, "open_issue", lambda *a: opened.append(a))
    summary = tmp_path / "summary.md"
    env = dict(ENV, TARGET_PRICE="650", GITHUB_TOKEN="t", GITHUB_REPOSITORY="me/repo",
               GITHUB_STEP_SUMMARY=str(summary))
    assert fw.main(fetch=lambda body: ROWS, env=env) == 0
    assert len(opened) == 1 and "628 USD" in opened[0][0]
    assert "Book on Google Flights" in summary.read_text()


def test_no_issue_when_not_a_deal(monkeypatch):
    opened = []
    monkeypatch.setattr(fw, "open_issue", lambda *a: opened.append(a))
    env = dict(ENV, TARGET_PRICE="600", GITHUB_TOKEN="t", GITHUB_REPOSITORY="me/repo")
    assert fw.main(fetch=lambda body: ROWS, env=env) == 0
    assert opened == []


def test_missing_key(capsys):
    assert fw.main(env=dict(ENV)) == 2
    assert "RAPIDAPI_KEY" in capsys.readouterr().out
