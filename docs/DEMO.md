# Demo Script — Priya Sharma, Data Analyst

**Setup time:** one command | **Demo time:** ~10 minutes

---

## Prerequisites

```powershell
python run.py
```

Open **http://localhost:5173**. On the sign-in page, choose a role chip (Admin, HR, Manager, IT, Facilities, or New hire) and sign in with `OnboardIQ-Demo!`. The seeded Priya Sharma plan is the shared starting scenario. Admin and HR can open **Demo controls** in the lower-right corner. Use `python run.py --reset` only when you intend to restore the demo scenario.

---

## Step-by-Step Demo

### 🟢 Step 1 — Show the Hire List (HR Page)
- Open **Overview** in the HR workspace
- Three hires are already seeded: **Priya Sharma** (Data Analyst, joining on the eighth organization business day from seed time), Alex Chen (SWE, Day 10), Maria Garcia (Marketing, Day 6). HR and the new-hire portal show the persisted calendar date; the demo clock still labels its simulation-day index.
- Point out the **readiness bars** — all at ~10% (only root tasks dispatched so far)
- Click **Priya Sharma** to open her detail

### 🔵 Step 2 — Inspect the Task Plan & Critical Path
- Show the **task list** — 10 tasks across IT, HR, Facilities
- Tasks highlighted in **red with ★ CRITICAL** are on the critical path
- Explain: *"High-RAM laptop provisioning takes 5 days and is the longest path to Day 1"*
- Point to **slack values**: laptop has 0 slack, HR contracts have positive slack
- Two tasks show `awaiting_approval` — Power BI License and Data Warehouse Access

### 🟡 Step 3 — Manager Approves Sensitive Access
- Sign in as Manager, then open **Approvals**
- Show **Pending Approvals**: "Power BI License & Access" and "Data Warehouse Access" for Priya
- Click **✓ Approve** for both
- Navigate back to Priya's detail → click **Run Monitor** in Demo Panel
- Both tasks now show `dispatched` with ticket IDs

### 🔴 Step 4 — IT Stalls the Laptop Ticket (Simulate Delay)
- Sign in as IT or Facilities, then open **Team queue**
- Find ticket for "Provision Laptop (High RAM)" for Priya → click **⚠ Stall**
- In Demo Panel: click **Advance Day** (day 1) → then **Advance Day** again (day 2)
- This simulates 2 idle days on the critical path
- Click **Run Monitor** (or Advance Day again which runs monitor automatically)

### 🚨 Step 5 — Observe Self-Healing: Escalation + Fallback
- Sign in as HR, open **Overview**, then select Priya's row to see her **Hire detail**
- **Audit timeline** shows (in red):
  > `🔴 ESCALATION: 'Provision Laptop' for Priya Sharma is stalled on the critical path. Slack=0.0d.`
  > `🟡 RESCHEDULED: 'Provision Laptop' → fallback 'Issue Loaner Laptop' (1d)`
- The task title has changed to **"Issue Loaner Laptop"** with 1-day duration
- **Manager page** shows escalation notification
- Hire status: **at_risk** (if deadline pressure) → will recover after laptop completes
- Click **🤖 Why is this at risk?** → plain English explanation

### 💥 Step 6 — ITSM Outage → Outbox → Zero Duplicates
- In Demo Panel: click **⚡ Toggle ITSM Offline** (button turns red "🔴 ITSM OFFLINE")
- While offline, create another hire from HR's **New hire** wizard and run the monitor. Its dispatch attempts go to the **outbox**
- Check metrics: `outbox_pending > 0`
- Toggle ITSM back **online**
- Click **Run Monitor** → outbox drains, tickets created
- Advance Day again → Run Monitor → no duplicate tickets ever (key assertion in tests)

### ✅ Step 7 — Day-1 Ready
- In IT Console: **Complete** all remaining open tickets for Priya
- Click **Run Monitor**
- Priya's status flips to **🎉 ready** with 100% readiness

### 📊 Step 8 — Insights & Experiment
- Navigate to **Insights** tab
- KPI cards: Day-1 Readiness %, Escalations, Stalls Rescued
- Click **▶ Run Experiment** (200 hires, 20% stall prob, seed 42)
- Bar chart appears: **Static Checklist ~65%** vs **Orchestrator ~87%**
- "+22% improvement" card lights up green
- Quote: *"This is a deterministic simulation — the methodology is documented. Real numbers come from production."*

---

## Demo Reset

```bash
curl -X POST http://localhost:8000/reset
python seed.py    # re-seeds fresh Priya scenario
```

Or click **🗑 Reset Demo** in Demo Panel, then re-run seed.py.

---

## Talking Points

| Slide | Point |
|-------|-------|
| Problem | "New hire stalls silently — nobody sees the critical path" |
| U1 CPM | "We recompute the critical path after every day advance with live remaining durations" |
| U2 Self-Healing | "2 idle days on the critical path → escalate + swap to loaner automatically" |
| U3 Vendor-Neutral | "Swap mock MCP for real ServiceNow MCP — zero agent code changes" |
| U4 Reliability | "One ticket per task, guaranteed. The outbox survived the simulated outage" |
| U5 Governance | "Every agent action is in the audit log. Manager approved before IT provisioned" |
| U6 Evidence | "22 percentage points better in the simulation. Real numbers need production data — we're honest about that" |
