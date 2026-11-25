import type { ReactNode } from 'react'
import type { Key } from 'react'

export type DataTableColumn<T> = {
  key: string
  header: ReactNode
  render: (row: T) => ReactNode
  headerClassName?: string
  className?: string
}

type DataTableProps<T> = {
  ariaLabel: string
  className: string
  rows: T[]
  columns: DataTableColumn<T>[]
  rowKey: (row: T) => Key
  rowClassName?: (row: T) => string
  emptyState?: ReactNode
}

export function DataTable<T>({ ariaLabel, className, rows, columns, rowKey, rowClassName, emptyState }: DataTableProps<T>) {
  return <table className={className} aria-label={ariaLabel}>
    <thead><tr>{columns.map(column => <th key={column.key} className={column.headerClassName}>{column.header}</th>)}</tr></thead>
    <tbody>
      {rows.map(row => <tr key={rowKey(row)} className={rowClassName?.(row)}>
        {columns.map(column => <td key={column.key} className={column.className}>{column.render(row)}</td>)}
      </tr>)}
      {rows.length === 0 && emptyState && <tr><td colSpan={columns.length}>{emptyState}</td></tr>}
    </tbody>
  </table>
}
