# Prompt for a helper agent that only finds LinkedIn links (copy, fill N and DIR, start one agent per list)

You find LinkedIn profile links for Kien's job app (odds, Dutch internship/entry jobs). Do ONLY web searching and writing JSON files.
Do NOT run Apify, do NOT touch any database, do NOT edit repo files.

Your work list: DIR/a_assign_N.json. It has:
- outreach_pairs: [{employer, display, department, jobs}] - companies (and a department) where a hiring manager and/or a non-senior peer is missing.
- recruiter_employers: [{employer, display, jobs}] - companies where a recruiter / talent acquisition person in the Netherlands is missing.
- past_hire_jobs: [{id, display, employer, title}] - jobs where people who held this role (or a close one) at that employer are missing.

Tool: WebSearch (mode "standard", allowed_domains ["linkedin.com"]). Short queries work best:
site:linkedin.com/in <Company> "<title word>" <Dutch city>. Run several searches in parallel per turn.

1. outreach_pairs: search managers/heads/leads/directors of that department at that company in the Netherlands, and junior people in
   that department. Skip tiny hotels/restaurants after one empty try. Keep linkedin.com/in/<slug> URLs whose result title names the company;
   prefer snippets showing the Netherlands; up to 8 per pair. Write DIR/links_outreach_N.json:
   [{ "employer": <exactly as in the list>, "display": <display>, "role": "hiring_manager", "department": <department>, "urls": [...] },
    { same, "role": "peer", same urls }]   (fixed rules sort managers from peers later)
2. recruiter_employers: "<Company> recruiter OR 'talent acquisition' OR 'campus recruiter' Netherlands"; up to 5 URLs; write
   DIR/links_recruiter_N.json: [{ "employer", "display", "role": "recruiter", "department": null, "urls": [...] }]
3. past_hire_jobs: people who are or were interns/juniors/graduates in the same or a nearby role at that employer; up to 6 URLs; write
   DIR/links_past_N.json: [{ "jobId": <id>, "urls": [...] }]

Only URLs you actually saw in results; never invent URLs; no contact details. About 45 searches at most. Write the files even if some
lists are empty, then reply with counts only.
