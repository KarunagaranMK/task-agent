import { expect, test, type Page } from '@playwright/test'
import { fileURLToPath } from 'node:url'

const axeScript = fileURLToPath(new URL('../node_modules/axe-core/axe.min.js', import.meta.url))

const roles = [
  { label: 'Admin', heading: 'Onboarding overview' },
  { label: 'HR', heading: 'Onboarding overview' },
  { label: 'Manager', heading: 'Your team’s readiness' },
  { label: 'IT', heading: 'Work queue' },
  { label: 'Facilities', heading: 'Work queue' },
  { label: 'New hire', heading: 'Welcome, Priya' },
]

async function signIn(page: Page, label: string) {
  await page.goto('/login')
  await page.getByRole('button', { name: label, exact: true }).click()
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible()
}

test('each demo role lands on its role-specific workspace', async ({ page }) => {
  for (const role of roles) {
    await signIn(page, role.label)
    await expect(page.getByRole('heading', { name: role.heading })).toBeVisible()
    if (role.label === 'New hire') {
      await expect(page.getByText(/TKT-[A-Z0-9]+/)).toHaveCount(0)
      await expect(page.getByRole('heading', { name: 'Your onboarding plan' })).toBeVisible()
    }
    await page.getByRole('button', { name: 'Sign out' }).click()
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible()
  }
})

test('HR can preview and create a role-specific onboarding plan', async ({ page }) => {
  await signIn(page, 'HR')
  await page.getByRole('button', { name: 'Create hire' }).click()
  await page.getByLabel('Full name').fill('QA Example')
  const joiningDate = await page.getByLabel('Joining date').inputValue()
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page.getByRole('heading', { name: 'Plan preview' })).toBeVisible()
  await expect(page.getByText('Provision Laptop (High RAM)')).toBeVisible()
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page.getByRole('heading', { name: 'Review and create' })).toBeVisible()
  const joiningDateLabel = await page.evaluate(value => new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(`${value}T12:00:00`)), joiningDate)
  await expect(page.getByRole('dialog').getByText(joiningDateLabel)).toBeVisible()
  const createResponse = page.waitForResponse(response => response.url().includes('/hires') && response.request().method() === 'POST')
  await page.getByRole('button', { name: /Create onboarding plan/ }).click()
  const createdHire = await createResponse
  expect((await createdHire.json()).start_date).toBe(joiningDate)
  await expect(page.getByRole('status')).toContainText('QA Example')
  await page.getByRole('link', { name: 'Open QA Example' }).click()
  await page.getByRole('button', { name: 'Edit details' }).click()
  const editDialog = page.getByRole('dialog', { name: 'Edit QA Example' })
  await editDialog.getByLabel('Department').fill('Operations')
  await editDialog.getByLabel('Manager').selectOption({ label: 'Alex Morgan' })
  const movedJoiningDate = await page.evaluate(value => {
    const date = new Date(`${value}T12:00:00`)
    let remaining = 2
    while (remaining > 0) { date.setDate(date.getDate() + 1); if (date.getDay() !== 0 && date.getDay() !== 6) remaining -= 1 }
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  }, joiningDate)
  await editDialog.getByLabel('Joining date').fill(movedJoiningDate)
  await editDialog.getByRole('button', { name: 'Save details' }).click()
  await expect(editDialog).toHaveCount(0)
  await expect(page.locator('.hire-hero-heading p')).toContainText('Operations')
  const movedJoiningDateLabel = await page.evaluate(value => new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(`${value}T12:00:00`)), movedJoiningDate)
  await expect(page.locator('.hire-kpis article').nth(1)).toContainText(movedJoiningDateLabel)
  await page.getByRole('button', { name: 'Pause' }).click()
  await expect(page.locator('.hire-hero .status-pill')).toHaveText(/Paused/i)
  await expect(page.getByText('Work is paused. Resume the plan when teams are ready.')).toBeVisible()
  await page.getByRole('button', { name: 'Resume' }).click()
  await expect(page.locator('.hire-hero .status-pill')).toHaveText(/On track/i)
  await page.getByRole('button', { name: 'Cancel plan' }).click()
  const cancelDialog = page.getByRole('dialog', { name: /Cancel QA Example’s onboarding/ })
  await expect(cancelDialog.getByRole('button', { name: 'Cancel onboarding' })).toBeDisabled()
  await cancelDialog.getByLabel('Type QA Example to confirm').fill('QA Example')
  await cancelDialog.getByRole('button', { name: 'Cancel onboarding' }).click()
  await expect(page.locator('.hire-hero .status-pill')).toHaveText(/Cancelled/i)
  await expect(page.getByText('This onboarding plan is closed.')).toBeVisible()
})

test('HR portfolio search and status filters are applied by the API', async ({ page }) => {
  await signIn(page, 'HR')
  await page.getByLabel('Search hires').fill('Priya')
  await expect(page).toHaveURL(/q=Priya/)
  await expect(page.getByRole('link', { name: 'Open Priya Sharma' })).toBeVisible()
  await expect(page.locator('.subtle-count')).toHaveText('1–1 of 1')
  await page.getByLabel('Search hires').fill('no matching hire')
  await expect(page.getByRole('heading', { name: 'No matching hires' })).toBeVisible()
  await page.getByLabel('Search hires').fill('')
  await page.getByRole('button', { name: 'At risk' }).click()
  await expect(page.getByRole('button', { name: 'At risk' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page).toHaveURL(/status=at_risk/)
  await page.getByRole('button', { name: 'Save view' }).click()
  await expect(page.locator('.saved-views .filter-chip')).toHaveText('At risk')
  await page.getByRole('button', { name: 'All hires' }).click()
  await page.locator('.saved-views .filter-chip').click()
  await expect(page.locator('.filter-chips .filter-chip').filter({ hasText: 'At risk' })).toHaveAttribute('aria-pressed', 'true')
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export CSV' }).click()
  expect((await download).suggestedFilename()).toBe('onboardiq-hire-portfolio.csv')
})

test('HR can bulk pause and resume selected hires on the current page', async ({ page }) => {
  await signIn(page, 'HR')
  await page.getByLabel('Select Priya Sharma').check()
  await expect(page.getByRole('region', { name: 'Bulk hire actions' })).toContainText('1 selected on this page')
  await page.getByRole('button', { name: 'Pause 1 selected' }).click()
  const priyaRow = page.locator('.hire-table tbody tr').filter({ hasText: 'Priya Sharma' })
  await expect(priyaRow.locator('.status-pill')).toHaveText('paused')
  await priyaRow.getByLabel('Select Priya Sharma').check()
  await page.getByRole('button', { name: 'Resume 1 selected' }).click()
  await expect(priyaRow.locator('.status-pill')).toHaveText(/On track|At risk/)
})

test('manager, IT, and new-hire interactions are keyboard reachable', async ({ page }) => {
  await signIn(page, 'Manager')
  await page.getByRole('link', { name: 'Approvals', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Approvals inbox' })).toBeVisible()
  await expect(page.getByRole('button', { name: /Approve/ }).first()).toBeVisible()

  await page.getByRole('button', { name: 'Sign out' }).click()
  await signIn(page, 'IT')
  await expect(page.getByRole('button', { name: 'List' })).toBeVisible()
  await page.getByRole('button', { name: 'List' }).click()
  await expect(page.getByRole('heading', { name: 'Team tickets' })).toBeVisible()

  await page.getByRole('button', { name: 'Sign out' }).click()
  await signIn(page, 'New hire')
  await page.getByRole('button', { name: 'Report an issue' }).click()
  await expect(page.getByRole('dialog', { name: 'What do you need help with?' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Send to HR' })).toBeDisabled()
})

test('admin can inspect templates, users, audit, and settings', async ({ page }) => {
  await signIn(page, 'Admin')
  await page.getByRole('link', { name: 'Templates' }).click()
  await expect(page.getByText('10 tasks')).toBeVisible()
  await page.getByRole('link', { name: 'People' }).click()
  await expect(page.getByRole('heading', { name: 'Team directory' })).toBeVisible()
  await page.getByRole('link', { name: 'Audit trail' }).click()
  await expect(page.getByRole('button', { name: 'Export CSV' })).toBeVisible()
  await page.getByRole('link', { name: 'Settings' }).click()
  await expect(page.getByRole('heading', { name: 'Service guardrails' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Move the simulation' })).toBeVisible()
})

test('template canvas edits dependencies and blocks cycles before publish', async ({ page }) => {
  await signIn(page, 'Admin')
  await page.getByRole('link', { name: 'Templates' }).click()
  const laptop = page.getByRole('button', { name: /IT · 5 DAYS Provision Laptop/ })
  await expect(laptop).toBeVisible()
  await laptop.click()
  await expect(page.getByLabel('Fallback task')).toHaveValue('Issue Loaner Laptop')
  await page.getByLabel('Fallback task').fill('Temporary loaner laptop')
  await expect(page.getByLabel('Fallback task')).toHaveValue('Temporary loaner laptop')
  const dependencies = page.locator('.template-dependency-options')
  await dependencies.locator('label').filter({ hasText: 'Create AD/Email Accounts' }).locator('input').check()
  await expect(page.getByText('Plan structure is valid and ready to publish.')).toBeVisible()
  await page.getByRole('button', { name: /Create AD\/Email Accounts/ }).click()
  await dependencies.locator('label').filter({ hasText: 'Provision Laptop (High RAM)' }).locator('input').check()
  await expect(page.getByRole('alert')).toContainText('dependency cycle')
  await expect(page.getByRole('button', { name: 'Validate & publish' })).toBeDisabled()
  await dependencies.locator('label').filter({ hasText: 'Provision Laptop (High RAM)' }).locator('input').uncheck()
  await expect(page.getByRole('alert')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Validate & publish' })).toBeEnabled()
})

test('every role can manage personal profile and notification preferences', async ({ page }) => {
  await signIn(page, 'HR')
  await page.getByRole('link', { name: 'Profile & preferences' }).click()
  await expect(page.getByRole('heading', { name: 'Profile & preferences' })).toBeVisible()
  await expect(page.getByLabel('Work email')).toHaveValue('hr@demo.local')
  await page.getByRole('checkbox', { name: /In-app notifications/ }).uncheck()
  await page.getByRole('button', { name: 'Save preferences' }).click()
  await expect(page.getByRole('status')).toContainText('Notification preferences saved')
})

test('admin guided walkthrough navigates the real product surfaces', async ({ page }) => {
  await signIn(page, 'Admin')
  await page.getByRole('button', { name: 'Open demo controls' }).click()
  await page.getByRole('button', { name: /Play guided demo/ }).click()
  await expect(page.getByText('Start with Priya’s plan')).toBeVisible()
  await page.getByRole('button', { name: 'Continue to next step' }).click()
  await expect(page).toHaveURL(/\/hire\/1$/)
  await expect(page.getByText('Review the access gate')).toBeVisible()
  await page.getByRole('button', { name: 'Continue to next step' }).click()
  await expect(page).toHaveURL(/\/it$/)
  await expect(page.getByRole('heading', { name: 'Work queue' })).toBeVisible()
  await page.getByRole('button', { name: 'Continue to next step' }).click()
  await page.getByRole('button', { name: 'Continue to next step' }).click()
  await expect(page).toHaveURL(/\/insights$/)
  await expect(page.getByText('Compare the outcome')).toBeVisible()
  await page.getByRole('button', { name: 'Finish walkthrough' }).click()
  await expect(page.getByText('Finish walkthrough')).toHaveCount(0)
})

test('Priya demo recovers from a stalled laptop and ITSM outage through her new-hire portal', async ({ page }) => {
  test.setTimeout(360_000)

  // Keep this acceptance run deterministic and isolated to Playwright's own DB.
  await signIn(page, 'Admin')
  await page.getByRole('link', { name: 'Settings' }).click()
  const autoWorker = page.getByRole('checkbox', { name: /Demo auto-worker/ })
  if (await autoWorker.isChecked()) await autoWorker.uncheck()
  await page.getByRole('button', { name: 'Save settings' }).click()
  await expect(page.getByRole('status')).toContainText('Workspace settings saved')
  await page.getByRole('button', { name: 'Open demo controls' }).click()
  page.once('dialog', dialog => dialog.accept())
  const resetResponse = page.waitForResponse(response => response.url().includes('/reset'))
  await page.getByRole('button', { name: /Reset Demo/ }).click()
  expect((await resetResponse).ok()).toBeTruthy()
  await page.locator('.demo-drawer-head').getByRole('button', { name: 'Close demo controls' }).click()

  // Manager decision unblocks role-protected work; HR runs the deterministic monitor.
  await page.getByRole('button', { name: 'Sign out' }).click()
  await signIn(page, 'Manager')
  await page.getByRole('link', { name: 'Approvals', exact: true }).click()
  const priyaApprovals = page.locator('.approval-item').filter({ hasText: 'Priya Sharma' })
  await expect(priyaApprovals).toHaveCount(2)
  for (let index = 0; index < 2; index += 1) {
    await priyaApprovals.first().getByRole('button', { name: 'Approve' }).click()
    await expect(priyaApprovals).toHaveCount(1 - index)
  }
  await page.getByRole('button', { name: 'Sign out' }).click()
  await signIn(page, 'HR')
  await page.getByRole('button', { name: 'Open demo controls' }).click()
  const initialMonitor = page.waitForResponse(response => response.url().includes('/monitor/tick'))
  await page.getByRole('button', { name: 'Run Monitor' }).click()
  expect((await initialMonitor).ok()).toBeTruthy()
  await page.locator('.demo-drawer-head').getByRole('button', { name: 'Close demo controls' }).click()

  // IT flags the critical laptop; the monitor advances two business days and applies its loaner fallback.
  await page.getByRole('button', { name: 'Sign out' }).click()
  await signIn(page, 'IT')
  const laptopCard = page.locator('.ticket-card').filter({ hasText: 'Provision Laptop (High RAM)' })
  await expect(laptopCard).toBeVisible()
  await laptopCard.getByRole('button', { name: 'Flag stalled' }).click()
  await page.getByRole('button', { name: 'Sign out' }).click()
  await signIn(page, 'HR')
  await page.getByRole('button', { name: 'Open demo controls' }).click()
  await page.getByRole('button', { name: 'Advance 1 business day' }).click()
  await page.getByRole('button', { name: 'Advance 1 business day' }).click()
  await page.locator('.demo-drawer-head').getByRole('button', { name: 'Close demo controls' }).click()
  await expect(page.locator('a.hire-name-link').filter({ hasText: 'Priya Sharma' })).toBeVisible()
  await page.locator('a.hire-name-link').filter({ hasText: 'Priya Sharma' }).click()
  await expect(page.locator('.next-action-list article').filter({ hasText: 'Issue Loaner Laptop' })).toBeVisible()

  // An outage queues downstream work. Recovery drains it using the stable task idempotency keys.
  await page.getByRole('button', { name: 'Open demo controls' }).click()
  await page.getByRole('button', { name: '⚡ Toggle ITSM Offline' }).click()
  await page.locator('.demo-drawer-head').getByRole('button', { name: 'Close demo controls' }).click()
  await page.getByRole('link', { name: 'Overview', exact: true }).click()
  await page.getByRole('button', { name: 'Create hire' }).click()
  await page.getByLabel('Full name').fill('Outage Recovery QA')
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page.getByRole('heading', { name: 'Plan preview' })).toBeVisible()
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByRole('button', { name: 'Create onboarding plan' }).click()
  await expect(page.getByRole('status')).toContainText('Outage Recovery QA')
  await page.getByRole('button', { name: 'Open demo controls' }).click()
  const outageMonitor = page.waitForResponse(response => response.url().includes('/monitor/tick'))
  await page.getByRole('button', { name: 'Run Monitor' }).click()
  expect((await outageMonitor).ok()).toBeTruthy()
  await page.getByRole('link', { name: 'Insights' }).click()
  const pendingMetric = page.locator('.grid > div').filter({ hasText: 'Outbox Pending' }).locator('.text-2xl')
  await expect(pendingMetric).not.toHaveText('0', { timeout: 10_000 })

  await expect(page.getByRole('button', { name: '🔴 ITSM OFFLINE' })).toBeVisible()
  await page.getByRole('button', { name: '🔴 ITSM OFFLINE' }).click()
  const recoveryMonitor = page.waitForResponse(response => response.url().includes('/monitor/tick'))
  await page.getByRole('button', { name: 'Run Monitor' }).click()
  expect((await recoveryMonitor).ok()).toBeTruthy()
  await expect(pendingMetric).toHaveText('0', { timeout: 15_000 })

  // The demo worker lets this browser run complete the remaining human-owned mock tickets.
  await page.locator('.demo-drawer-head').getByRole('button', { name: 'Close demo controls' }).click()
  await page.getByRole('button', { name: 'Sign out' }).click()
  await signIn(page, 'Admin')
  await page.getByRole('link', { name: 'Settings' }).click()
  const completionWorker = page.getByRole('checkbox', { name: /Demo auto-worker/ })
  if (!(await completionWorker.isChecked())) await completionWorker.check()
  await page.getByRole('button', { name: 'Save settings' }).click()
  await expect(page.getByRole('status')).toContainText('Workspace settings saved')
  await page.getByRole('button', { name: 'Sign out' }).click()
  await signIn(page, 'HR')
  await page.getByRole('button', { name: 'Open demo controls' }).click()
  await page.getByRole('button', { name: 'Advance 1 business day' }).click()
  for (let day = 0; day < 12; day += 1) {
    await page.getByRole('button', { name: 'Advance 1 business day' }).click()
  }
  await page.locator('.demo-drawer-head').getByRole('button', { name: 'Close demo controls' }).click()
  await page.getByRole('link', { name: 'Overview', exact: true }).click()
  const readyResponse = page.waitForResponse(response => response.url().endsWith('/hires/1') && response.request().method() === 'GET')
  await page.locator('a.hire-name-link').filter({ hasText: 'Priya Sharma' }).click()
  expect(await (await readyResponse).json()).toMatchObject({ status: 'ready', readiness: 100 })
  await expect(page.locator('.hire-hero .status-pill')).toHaveText(/Ready/i, { timeout: 30_000 })

  await page.getByRole('button', { name: 'Sign out' }).click()
  await signIn(page, 'New hire')
  await expect(page.getByRole('heading', { name: 'You’re ready to go' })).toBeVisible({ timeout: 20_000 })
})

test('primary role pages have no serious or critical axe findings', async ({ page }) => {
  await signIn(page, 'Admin')
  const paths = ['/', '/hire/1', '/insights', '/templates', '/users', '/audit', '/settings']
  const findings: string[] = []
  for (const path of paths) {
    if (path === '/hire/1') await page.locator('a[href="/hire/1"]').first().click()
    else if (path !== '/') await page.locator(`a[href="${path}"]`).first().click()
    await page.getByRole('heading').first().waitFor()
    await page.addScriptTag({ path: axeScript })
    const serious = await page.evaluate(async () => {
      const engine = (window as Window & { axe?: { run: (node: Document) => Promise<{ violations: Array<{ impact: string | null; id: string }> }> } }).axe
      if (!engine) throw new Error('axe-core failed to load')
      const result = await engine.run(document)
      return result.violations.filter(item => item.impact === 'serious' || item.impact === 'critical').map(item => `${item.impact}:${item.id} ${item.nodes.map(node => `${node.target.join(',')} ${node.failureSummary ?? ''} ${node.html}`).join(';')}`)
    })
    findings.push(...serious.map(item => `${path} ${item}`))
    if (path === '/hire/1') {
      await page.getByRole('button', { name: 'Graph' }).click()
      await expect(page.getByRole('heading', { name: 'How the work connects' })).toBeVisible()
      await page.locator('.graph-node.is-critical').first().click()
      await expect(page.getByRole('dialog', { name: 'Task details' })).toBeVisible()
      await page.getByRole('button', { name: 'Close task details' }).click()
      await page.getByRole('button', { name: 'Schedule', exact: true }).click()
      await expect(page.getByRole('img', { name: /Task schedule from day 0/ })).toBeVisible()
    }
  }
  expect(findings).toEqual([])
})
