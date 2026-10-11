#!/usr/bin/env python3
"""Every dated money figure and headcount Wikidata holds for the employers with jobs in the last 30 days, newest jobs first, so growth
can be read from two or more years. Free and sourced (CC0); nothing is converted, estimated or written by a model.

  python3 skills/odds-company-info/scripts/wikidata.py [--days 30] [--write]     (without --write it only prints)

Matching is strict: first the Wikidata item whose official website (P856) is the employer's website; otherwise an item whose label is
exactly the company's name and whose description calls it a company or organisation. A figure is kept only with its currency (money)
and its point in time (P585), from 2010 on. Money goes to employer_money (one row per kind and year), headcount to employer_headcount
with source 'wikidata' (worldwide, as the company reports it; never compared with LinkedIn's count).
"""
import json, os, re, sys, time, urllib.parse, urllib.request

def _key(name):
    """From the environment, else from the odds repo's .env.secrets (ODDS_REPO, default ../../../../odds-beebalst)."""
    if os.environ.get(name):
        return os.environ[name]
    repo = os.environ.get("ODDS_REPO") or os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "..", "odds-beebalst")
    for f in (".env.secrets", ".env.local"):
        try:
            for line in open(os.path.join(repo, f)):
                if line.startswith(name + "="):
                    return line.split("=", 1)[1].strip()
        except OSError:
            pass
    sys.exit(f"Missing {name}")
PAT = _key("SUPABASE_ACCESS_TOKEN")
REF = os.environ.get("ODDS_PROJECT_REF", "ukpmpyfcnbhngkgbnkxi")
WRITE = "--write" in sys.argv
DAYS = int(sys.argv[sys.argv.index("--days") + 1]) if "--days" in sys.argv else 30
UA = {"User-Agent": "odds-research/0.3 (company facts for a student job app; https://github.com/hanhquyenna/odds-beebalst)"}
CUR = {"Q4916": "EUR", "Q4917": "USD", "Q25224": "GBP", "Q25344": "CHF", "Q8146": "JPY", "Q39099": "CNY", "Q122922": "SEK", "Q25417": "DKK",
       "Q132643": "NOK", "Q1104069": "CAD", "Q259502": "AUD", "Q131016": "CZK", "Q123213": "PLN", "Q41044": "INR", "Q202040": "KRW"}
MONEY = {"revenue": "P2139", "net_profit": "P2295", "market_value": "P2226", "total_assets": "P2403"}
BIZ = re.compile(r"\b(company|corporation|bank|retailer|manufacturer|firm|multinational|brand|university|organi[sz]ation|agency|startup|"
                 r"supermarket|airline|insurer|insurance|consultancy|conglomerate|group|chain|business|enterprise|platform|developer|producer|"
                 r"maker|institute|foundation|exchange|trading|subsidiary|holding)\b", re.I)
norm = lambda s: re.sub(r"[^a-z0-9]", "", re.sub(r"&amp;", "&", (s or "").lower()))


def sql(q):
    rq = urllib.request.Request(f"https://api.supabase.com/v1/projects/{REF}/database/query", data=json.dumps({"query": q}).encode(),
                                headers={"Authorization": f"Bearer {PAT}", "Content-Type": "application/json", "User-Agent": "odds"})
    for attempt in range(5):
        try:
            return json.loads(urllib.request.urlopen(rq, timeout=180).read())
        except Exception:
            time.sleep(3 * (attempt + 1))
    raise RuntimeError("database query failed")


def get(url):
    for attempt in range(4):
        try:
            time.sleep(0.4)
            return json.load(urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=40))
        except urllib.error.HTTPError as e:
            time.sleep(int(e.headers.get("Retry-After") or 10) + 5 * attempt)
        except Exception:
            time.sleep(3 * (attempt + 1))
    return None


LEGAL = re.compile(r"\b(n\.?v\.?|b\.?v\.?|holdings?|group|company|corporation|corp|inc|plc|ltd|limited|ag|se|sa|gmbh|nederland|netherlands|the|international|global)\b", re.I)
core = lambda s: norm(LEGAL.sub(" ", re.sub(r"&amp;", "&", s or "")))


def root(url):
    host = re.sub(r"^https?://", "", (url or "").strip().lower()).split("/")[0].split(":")[0]
    host = re.sub(r"^(www\d?|jobs|careers|career|werkenbij|werken)\.", "", host)
    parts = host.split(".")
    if len(parts) >= 3 and parts[-2] in ("co", "com", "ac"):
        return ".".join(parts[-3:])
    return ".".join(parts[-2:]) if "." in host else None


def find_item(name, site):
    """Search Wikidata by name, then keep the candidate whose official website (P856) is on the employer's own domain. Without a website
    match, accept only a single candidate whose name (legal words removed) equals the company's and whose description says company."""
    d = get("https://www.wikidata.org/w/api.php?action=wbsearchentities&language=en&type=item&limit=10&format=json&search=" + urllib.parse.quote(name))
    cands = [c for c in (d or {}).get("search", [])]
    if not cands:
        return None
    ents = (get("https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&props=claims|descriptions|labels|aliases&languages=en&ids=" + "|".join(c["id"] for c in cands)) or {}).get("entities", {})
    want = root(site)
    if want:
        by_site = [q for q, e in ents.items() if any(root(((x.get("mainsnak", {}).get("datavalue") or {}).get("value"))) == want for x in e.get("claims", {}).get("P856", []))]
        if len(by_site) > 1:
            # Branches share the domain ("ASML (United States)" at asml.com/asml/show.do): keep the one whose website is the home page.
            home = [q for q in by_site if any(re.sub(r"^https?://(www\.)?", "", str((x.get("mainsnak", {}).get("datavalue") or {}).get("value", ""))).rstrip("/").count("/") == 0 for x in ents[q].get("claims", {}).get("P856", []))]
            by_site = home if home else by_site
        pick = clear_winner(by_site, ents)
        if pick:
            return pick
    named = []
    for q, e in ents.items():
        labels = [((e.get("labels") or {}).get("en") or {}).get("value", "")] + [a.get("value", "") for a in (e.get("aliases") or {}).get("en", [])]
        desc = ((e.get("descriptions") or {}).get("en") or {}).get("value", "")
        if core(name) and any(core(l) == core(name) for l in labels) and BIZ.search(desc):
            named.append(q)
    return clear_winner(named, ents)


def clear_winner(qids, ents):
    """One candidate, or the one with at least twice the statements of the next (the company itself, not a brand or a branch)."""
    if len(qids) <= 1:
        return qids[0] if qids else None
    size = sorted(((sum(len(v) for v in ents[q].get("claims", {}).values()), q) for q in qids), reverse=True)
    return size[0][1] if size[0][0] >= 2 * size[1][0] else None


def when(claim):
    t = (((claim.get("qualifiers", {}).get("P585") or [{}])[0].get("datavalue", {}) or {}).get("value", {}) or {}).get("time", "")
    m = re.match(r"\+(\d{4})-(\d{2})-(\d{2})", t)
    if not m:
        return None
    y, mo, d = int(m.group(1)), max(int(m.group(2)), 1), max(int(m.group(3)), 1)
    return (y, f"{y:04d}-{mo:02d}-{d:02d}")


rows = sql(f"""
  select a.employer, coalesce(f.name, a.display) as name, f.website, a.newest
  from (select employer, min(employer_display) display, max(coalesce(posted_on, current_date - days_open)) newest
        from app_jobs where level_view in ('Internship','Entry') and dutch_required is not true
          and coalesce(posted_on, current_date - days_open) >= current_date - {DAYS}
        group by 1) a
  left join employer_facts f on f.employer = a.employer
  order by a.newest desc, a.employer""")
print(f"{len(rows)} employers with jobs in the last {DAYS} days", flush=True)

money, heads, matched = [], [], 0
VERBOSE = "--verbose" in sys.argv
for i, r in enumerate(rows):
    name = (r["name"] or r["employer"]).replace("&amp;", "&")
    t0 = time.time()
    qid = find_item(name, r.get("website"))
    if VERBOSE:
        print(f"  {name}: {qid} ({time.time() - t0:.1f}s)", flush=True)
    if not qid:
        continue
    e = get(f"https://www.wikidata.org/wiki/Special:EntityData/{qid}.json")
    claims = ((e or {}).get("entities", {}).get(qid, {}) or {}).get("claims", {})
    got = 0
    for kind, prop in MONEY.items():
        per_year = {}
        for c in claims.get(prop, []):
            v = (c.get("mainsnak", {}).get("datavalue", {}) or {}).get("value", {}) or {}
            unit = (v.get("unit") or "").rsplit("/", 1)[-1]
            w = when(c)
            if not v.get("amount") or unit not in CUR or not w or w[0] < 2010:
                continue
            # One figure per year: a preferred-rank statement wins, else the first.
            if w[0] not in per_year or c.get("rank") == "preferred":
                per_year[w[0]] = (float(v["amount"]), CUR[unit])
        for y, (amount, cur) in per_year.items():
            money.append((r["employer"], kind, amount, cur, y, qid)); got += 1
    seen = set()
    for c in claims.get("P1128", []):
        v = (c.get("mainsnak", {}).get("datavalue", {}) or {}).get("value", {}) or {}
        w = when(c)
        if not v.get("amount") or not w or w[0] < 2010 or w[1] in seen:
            continue
        seen.add(w[1]); heads.append((r["employer"], w[1], int(float(v["amount"])))); got += 1
    if got:
        matched += 1
    if (i + 1) % 25 == 0:
        print(f"  {i + 1}/{len(rows)}: {matched} matched, {len(money)} money figures, {len(heads)} headcounts", flush=True)

years = {}
for e, k, *_ in money:
    years.setdefault((e, k), 0)
    years[(e, k)] += 1
print(f"done: {matched} employers with figures; {len(money)} money figures, {len(heads)} headcounts; "
      f"{len({e for (e, k), n in years.items() if k == 'revenue' and n >= 2})} with revenue in 2+ years")

if WRITE and (money or heads):
    q = lambda s: "$q$" + str(s) + "$q$"
    for i in range(0, len(money), 400):
        vals = ",".join(f"({q(e)},{q(k)},{a},{q(c)},{y},{q(w)})" for e, k, a, c, y, w in money[i:i + 400])
        sql(f"insert into employer_money (employer, kind, amount, currency, year, wikidata_id) values {vals} "
            "on conflict (employer, kind, year) do update set amount = excluded.amount, currency = excluded.currency, wikidata_id = excluded.wikidata_id, read_on = current_date")
    for i in range(0, len(heads), 400):
        vals = ",".join(f"({q(e)},{q(d)},{n},'wikidata')" for e, d, n in heads[i:i + 400])
        sql(f"insert into employer_headcount (employer, read_on, employees, source) values {vals} "
            "on conflict (employer, read_on, source) do update set employees = excluded.employees")
    print("written")
