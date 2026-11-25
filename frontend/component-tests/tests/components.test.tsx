import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ApprovalCard, type ApprovalTask } from '../../src/components/ApprovalCard'
import { DataTable, type DataTableColumn } from '../../src/components/DataTable'
import { ReadinessRing } from '../../src/components/ReadinessRing'
import { StatusPill } from '../../src/components/StatusPill'
import { GanttCriticalPath } from '../../src/components/TaskVisualizations'
import type { Task } from '../../src/api/client'

const task: Task = {
  id: 'task-1', key: 'it:account', title: 'Create secure account', team: 'IT', duration_days: 2,
  depends_on: [], needs_approval: true, approval_state: 'pending', status: 'queued', ticket_id: null,
  slack: 1, critical: true, flag: 'none', dispatched_day: null, remaining_days: 2,
  schedule_start_day: 1, schedule_finish_day: 3, current_day: 0,
}

describe('ReadinessRing', () => {
  it('announces a bounded percentage to assistive technology', () => {
    render(<ReadinessRing value={132.4} />)
    const ring = screen.getByRole('progressbar', { name: 'Day-1 readiness' })
    expect(ring).toHaveAttribute('aria-valuenow', '100')
    expect(ring).toHaveAttribute('aria-valuetext', '100% complete')
    expect(ring).toHaveTextContent('100%')
  })
})

describe('StatusPill', () => {
  it('formats a status and applies its semantic tone', () => {
    render(<StatusPill status="awaiting_approval" />)
    expect(screen.getByText('awaiting approval')).toHaveClass('status-pill', 'warning')
  })
})

describe('GanttCriticalPath', () => {
  it('lets keyboard users open task details from the schedule', async () => {
    const user = userEvent.setup()
    render(<GanttCriticalPath tasks={[task]} dayOne={5} currentDay={0} />)
    const row = screen.getByRole('button', { name: 'Inspect Create secure account schedule details' })
    row.focus()
    await user.keyboard('{Enter}')
    expect(screen.getByRole('dialog', { name: 'Task details' })).toBeInTheDocument()
    expect(screen.getByText('Estimated effort')).toBeInTheDocument()
  })
})

describe('DataTable', () => {
  it('renders labeled rows and interactive cell content', async () => {
    const user = userEvent.setup()
    const onOpen = vi.fn()
    const columns: DataTableColumn<{ id: string; name: string }>[] = [
      { key: 'name', header: 'Name', render: row => row.name },
      { key: 'actions', header: 'Actions', render: row => <button onClick={() => onOpen(row.id)}>Open {row.name}</button> },
    ]
    render(<DataTable ariaLabel="Team members" className="members" rows={[{ id: 'u1', name: 'Jordan Lee' }]} columns={columns} rowKey={row => row.id} />)
    expect(screen.getByRole('table', { name: 'Team members' })).toBeInTheDocument()
    expect(screen.getByRole('row', { name: /Jordan Lee/ })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Open Jordan Lee' }))
    expect(onOpen).toHaveBeenCalledWith('u1')
  })
})

describe('ApprovalCard', () => {
  it('routes approval decisions and disables actions while pending', async () => {
    const user = userEvent.setup()
    const onApprove = vi.fn()
    const onReject = vi.fn()
    const approval: ApprovalTask = { ...task, hire_name: 'Jordan Lee' }
    const { rerender } = render(<ApprovalCard task={approval} onApprove={onApprove} onReject={onReject} />)
    await user.click(screen.getByRole('button', { name: 'Approve' }))
    await user.click(screen.getByRole('button', { name: 'Reject' }))
    expect(onApprove).toHaveBeenCalledWith('task-1')
    expect(onReject).toHaveBeenCalledWith('task-1')

    rerender(<ApprovalCard task={approval} disabled onApprove={onApprove} onReject={onReject} />)
    expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Reject' })).toBeDisabled()
  })
})
