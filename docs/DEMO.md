# Demo Script — Priya Sharma, Data Analyst

**Setup time:** ~2 minutes | **Demo time:** ~10 minutes

---

## Prerequisites

```bash
# Terminal 1 — Backend
cd backend
pip install -r requirements.txt
python seed.py          # loads Priya + 2 other hires, runs first monitor tick
uvicorn app.main:app --reload --port 8000

# Terminal 2 — Frontend
cd frontend
npm install && npm run dev
# Open http://localhost:5173
```

---

## Step-by-Step Demo

### 🟢 Step 1 — Show the Hire List (HR Page)
- Navigate to the **HR** tab
- Three hires are already seeded: **Priya Sharma** (Data Analyst, Day 8), Alex Chen (SWE, Day 10), Maria Garcia (Marketing, Day 6)
- Point out the **readiness bars** — all at ~10% (only root tasks dispatched so far)
- Click **Priya Sharma** to open her detail

### 🔵 Step 2 — Inspect the Task Plan & Critical Path
- Show the **task list** — 10 tasks across IT, HR, Facilities
- Tasks highlighted in **red with ★ CRITICAL** are on the critical path
- Explain: *"Laptop provisioning takes 3 days and blocks nothing else — it IS the critical path"*
- Point to **slack values**: laptop has 0 slack, HR contracts have positive slack
- Two tasks show `awaiting_approval` — Power BI License and Data Warehouse Access

### 🟡 Step 3 — Manager Approves Sensitive Access
- Navigate to **Manager** tab
- Show **Pending Approvals**: "Power BI License & Access" and "Data Warehouse Access" for Priya
- Click **✓ Approve** for both
- Navigate back to Priya's detail → click **Run Monitor** in Demo Panel
- Both tasks now show `dispatched` with ticket IDs

### 🔴 Step 4 — IT Stalls the Laptop Ticket (Simulate Delay)
- Navigate to **IT / Facilities Console**
- Find ticket for "Provision Laptop (High RAM)" for Priya → click **⚠ Stall**
- In Demo Panel: click **Advance Day** (day 1) → then **Advance Day** again (day 2)
- This simulates 2 idle days on the critical path
- Click **Run Monitor** (or Advance Day again which runs monitor automatically)

### 🚨 Step 5 — Observe Self-Healing: Escalation + Fallback
- Navigate to Priya's **Hire Detail**
- **Audit timeline** shows (in red):
  > `🔴 ESCALATION: 'Provision Laptop' for Priya Sharma is stalled on the critical path. Slack=0.0d.`
  > `🟡 RESCHEDULED: 'Provision Laptop' → fallback 'Issue Loaner Laptop' (1d)`
- The task title has changed to **"Issue Loaner Laptop"** with 1-day duration
- **Manager page** shows escalation notification
- Hire status: **at_risk** (if deadline pressure) → will recover after laptop completes
- Click **🤖 Why is this at risk?** → plain English explanation

### 💥 Step 6 — ITSM Outage → Outbox → Zero Duplicates
- In Demo Panel: click **⚡ Toggle ITSM Offline** (button turns red "🔴 ITSM OFFLINE")
- Click **Advance Day** → new tasks (from Maria's plan) attempt dispatch → they go to **outbox**
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
