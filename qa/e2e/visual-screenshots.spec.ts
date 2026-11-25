import { expect, test, type Page } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'

test('capture all role routes at required sizes and themes', async ({ browser }) => {
  test.setTimeout(15 * 60 * 1000)
  const output = resolve(process.cwd(), '..', 'docs', 'screenshots')
  await mkdir(output, { recursive: true })
  const roles = [
    { name: 'Admin', routes: ['/', '/hire/:id', '/manager', '/it', '/insights', '/templates', '/users', '/audit', '/settings', '/app/dev/mail'] },
    { name: 'HR', routes: ['/', '/hire/:id', '/insights', '/templates', '/audit'] },
    { name: 'Manager', routes: ['/', '/manager', '/hire/:id'] },
    { name: 'IT', routes: ['/it'] },
    { name: 'Facilities', routes: ['/it'] },
    { name: 'New hire', routes: ['/my-onboarding'] },
  ]
  const safe = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '-')
  for (const width of [390, 768, 1440]) {
    for (const theme of ['light', 'dark'] as const) {
      for (const role of roles) {
        const context = await browser.newContext({ viewport: { width, height: 1000 }, colorScheme: theme })
        await context.addInitScript(value => localStorage.setItem('onboardiq-theme', value), theme)
        const page = await context.newPage()
        await page.goto('/login')
        await page.getByRole('heading', { name: 'Sign in to your workspace' }).waitFor()
        await page.screenshot({ path: resolve(output, `${safe(role.name)}-login-${width}-${theme}.png`), fullPage: true, animations: 'disabled' })
        await page.getByRole('button', { name: role.name, exact: true }).click()
        await page.getByRole('button', { name: 'Sign in' }).click()
        await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible()
        for (const route of role.routes) {
          const routePath = route === '/hire/:id'
            ? await page.locator('a.hire-name-link').filter({ hasText: 'Priya Sharma' }).getAttribute('href')
            : route
          if (routePath && routePath !== '/') {
            await page.evaluate(path => {
              window.history.pushState({}, '', path)
              window.dispatchEvent(new PopStateEvent('popstate'))
            }, routePath)
          }
          await page.locator('.page-skeleton').waitFor({ state: 'detached' }).catch(() => undefined)
          await page.getByRole('heading').first().waitFor()
          if (route === '/' && ['Admin', 'HR'].includes(role.name)) {
            await expect(page.getByText('Hire portfolio')).toBeVisible()
            await expect(page.getByText('Priya Sharma')).toBeVisible()
          }
          if (route === '/hire/:id') {
            await expect(page.getByRole('heading', { name: 'Priya Sharma' })).toBeVisible()
            await expect(page.getByText('Provision Laptop (High RAM)', { exact: true }).first()).toBeVisible()
          }
          if (route === '/insights') await expect(page.getByText('Day-1 Readiness')).toBeVisible()
          if (route === '/templates') await expect(page.getByText('10 tasks')).toBeVisible()
          if (route === '/users') await expect(page.getByRole('heading', { name: 'Team directory' })).toBeVisible()
          if (route === '/audit') await expect(page.locator('.audit-row').first()).toBeVisible()
          if (route === '/manager') await expect(page.getByRole('heading', { name: 'Approvals inbox' })).toBeVisible()
          if (route === '/it') {
            await expect(page.getByRole('heading', { name: 'Work queue' })).toBeVisible()
            await expect(page.getByRole('button', { name: 'List' })).toBeVisible()
          }
          if (route === '/my-onboarding') await expect(page.getByRole('heading', { name: 'Your onboarding plan' })).toBeVisible()
          if (route === '/app/dev/mail') await expect(page.getByRole('heading', { name: 'Development mail outbox' })).toBeVisible()
          await page.waitForTimeout(250)
          const documentWidth = await page.evaluate(() => document.documentElement.scrollWidth)
          expect(documentWidth, `${role.name} ${route} overflows at ${width}px`).toBeLessThanOrEqual(width)
          const routeName = route === '/hire/:id' ? 'hire-1' : route === '/' ? 'overview' : route.slice(1)
          await page.screenshot({ path: resolve(output, `${safe(role.name)}-${safe(routeName)}-${width}-${theme}.png`), fullPage: true, animations: 'disabled' })
          if (route === '/hire/:id') {
            await page.getByRole('button', { name: 'Graph' }).click()
            await expect(page.getByRole('heading', { name: 'How the work connects' })).toBeVisible()
            await page.screenshot({ path: resolve(output, `${safe(role.name)}-hire-1-graph-${width}-${theme}.png`), fullPage: true, animations: 'disabled' })
            await page.getByRole('button', { name: 'Schedule', exact: true }).click()
            await expect(page.getByRole('img', { name: /Task schedule from day 0/ })).toBeVisible()
            await page.screenshot({ path: resolve(output, `${safe(role.name)}-hire-1-schedule-${width}-${theme}.png`), fullPage: true, animations: 'disabled' })
            await page.getByRole('button', { name: 'Overview', exact: true }).click()
          }
        }
        await context.close()
      }
    }
  }
})
