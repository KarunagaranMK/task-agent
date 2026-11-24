import { expect, test, type Page } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'

test('capture all role routes at required sizes and themes', async ({ browser }) => {
  test.setTimeout(15 * 60 * 1000)
  const output = resolve(process.cwd(), '..', 'docs', 'screenshots')
  await mkdir(output, { recursive: true })
  const roles = [
    { name: 'Admin', routes: ['/', '/hire/1', '/manager', '/it', '/insights', '/templates', '/users', '/audit', '/settings', '/app/dev/mail'] },
    { name: 'HR', routes: ['/', '/hire/1', '/insights', '/templates', '/audit'] },
    { name: 'Manager', routes: ['/', '/manager', '/hire/1'] },
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
          if (route !== '/') {
            await page.evaluate(path => {
              window.history.pushState({}, '', path)
              window.dispatchEvent(new PopStateEvent('popstate'))
            }, route)
          }
          await page.locator('.page-skeleton').waitFor({ state: 'detached' }).catch(() => undefined)
          await page.getByRole('heading').first().waitFor()
          if (route === '/' && ['Admin', 'HR'].includes(role.name)) {
            await expect(page.getByText('Hire portfolio')).toBeVisible()
            await expect(page.getByText('Priya Sharma')).toBeVisible()
          }
          if (route === '/hire/1') {
            await expect(page.getByRole('heading', { name: 'Priya Sharma' })).toBeVisible()
            await expect(page.getByText('Provision Laptop (High RAM)', { exact: true }).nth(1)).toBeVisible()
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
          await page.screenshot({ path: resolve(output, `${safe(role.name)}-${safe(route === '/' ? 'overview' : route.slice(1))}-${width}-${theme}.png`), fullPage: true, animations: 'disabled' })
        }
        await context.close()
      }
    }
  }
})
