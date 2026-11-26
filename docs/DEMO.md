# OnboardFlow AI: sample walkthrough

This walkthrough demonstrates a hire from HR intake through team work, approval, risk recovery, and Day-1 readiness. It uses the local mock HRIS and ITSM services; no Gemini key or real enterprise account is needed.

## Start and sign in

From the project root, start the local demo:

```powershell
python run.py
```

Open `http://localhost:5173`. On the sign-in page, select a demo role chip; the chip fills its email and password. All demo roles use `OnboardIQ-Demo!`:

- Admin: `admin@demo.local`
- HR: `hr@demo.local`
- Manager: `manager@demo.local`
- IT: `it@demo.local`
- Facilities: `facilities@demo.local`
- New hire: `newhire@demo.local`

The HR and new-hire views start with the seeded **Priya Sharma** onboarding plan. Choose **Project guide** from the sign-in screen if you want a short explanation of the architecture before the walkthrough.

## Sample 1: create and review a new hire

1. Sign in as **HR** and open **Overview**.
2. Select **Create hire** and enter:
   - Name: `Anika Rao`
   - Role: `Data Analyst`
   - Department: `Analytics`
   - Manager: `Alex Morgan`
   - Joining date: leave the suggested business day, or choose a future business day.
3. Open **Additional employee information** if you want to add optional work email, work location, employment type, equipment, software, or notes.
4. Select **Continue** to preview the role-specific tasks. Review the task owners and dependencies, then continue to the confirmation step.
5. Select **Create onboarding plan**. The hire appears in the portfolio. Open the hire to see readiness, the task list, schedule, dependency graph, what-if simulator, and activity timeline.

The preview is a template-backed plan. Gemini can suggest task text when configured, but the validated plan and workflow rules remain usable without a model key.

## Sample 2: see cross-team work and approval

1. Open Anika's **Tasks** tab as HR and note the team owners and dependencies.
2. Sign out, select **Manager**, and open **Approvals**. Approve the sensitive access request for Anika.
3. Sign out, select **IT**, and open **Team queue**. Open an assigned ticket and use the available work actions to progress it.
4. Return to HR and open the hire's **Activity** tab. The approval and task events are recorded there; the overview updates readiness as work is completed.

**What the system does:** CPM orders dependent work and calculates slack against the joining date. The LangGraph supervisor routes planning and monitoring nodes. Managers and team members make the approvals and work decisions; the app records them and updates the plan.

## Sample 3: demonstrate the delay recovery

Use the seeded **Priya Sharma** plan for a repeatable critical-path example.

1. Sign in as **Manager** and approve Priya's pending access requests.
2. Sign in as **IT**, find Priya's **Provision Laptop (High RAM)** ticket, and select **Flag stalled**.
3. Sign in as **HR**. Open **Demo controls** and advance the simulation by two business days, then run the monitor.
4. Open Priya's hire detail. Review **Next actions**, **Activity**, and **Graph**. The monitor identifies the stalled critical task, records an escalation, and proposes the configured **Issue Loaner Laptop** fallback.
5. Sign in as Manager to review any pending approval. After approval, sign in as IT to process the loaner ticket. Run the monitor again to recalculate schedule and readiness.

The fallback is a policy-driven demo rule. The model does not approve access or choose whether a human approval should be granted.

## Sample 4: show the outbox retry

1. As HR, open **Demo controls** and switch **ITSM Offline** on.
2. Create a hire or run the monitor while offline so a ticket request is queued.
3. Open **Integrations** and inspect the pending outbox item.
4. Switch ITSM back online and run the monitor. The outbox retries the request using its idempotency key; the pending count should return to zero without duplicate tickets.

## Finish at Day-1 readiness

1. In Admin **Settings**, enable **Demo auto-worker** and save.
2. As HR, open **Demo controls** and advance business days, running the monitor as needed.
3. Follow the remaining tasks in IT and Facilities queues. When all mandatory tasks are complete, Priya's hire shows **Ready** and **100% readiness**; the new-hire portal shows the completion state.
4. Open **Insights** to review operational metrics or run the reproducible readiness experiment. Its results are illustrative simulation data, not production measurements.

## Reset the walkthrough

- For a fresh local database, stop the app and run `python run.py --reset`.
- In the running demo, an Admin can select **Reset Demo** in Demo controls. This restores the seeded hires and mock integration state. Then select **Run Monitor** to create the initial task tickets and approval requests.

## How to explain the project in 30 seconds

> “OnboardFlow AI gives HR, managers, IT, and Facilities one shared onboarding plan. A validated role template builds the tasks; CPM calculates dependencies and Day-1 risk; a LangGraph supervisor routes planning and monitoring; and MCP connects the app to local mock HRIS and ITSM services. People approve sensitive access and complete work. The app records progress, retries integration requests safely, and keeps readiness visible. Gemini is optional and only assists with suggestions or wording.”
