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
