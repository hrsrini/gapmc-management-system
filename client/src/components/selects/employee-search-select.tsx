"use client"

import * as React from "react"

import {
  AsyncSearchSelect,
  type AsyncSearchSelectOption,
  type AsyncSearchSelectProps,
} from "@/components/ui/async-search-select"
import {
  formatEmployeeSelectLabel,
  type EmployeeSelectFields,
} from "@shared/select-display-labels"

export type EmployeeSearchSelectProps = Omit<
  AsyncSearchSelectProps,
  "onSearch" | "resolveOption" | "searchPlaceholder"
> & {
  yardId?: string
  includeApp?: boolean
  excludeId?: string
  searchPlaceholder?: string
}

function toOption(employee: EmployeeSelectFields): AsyncSearchSelectOption {
  const label = formatEmployeeSelectLabel(employee)
  return {
    value: employee.id,
    label,
    keywords: label,
  }
}

function buildEmployeesUrl(params: Record<string, string | undefined>): string {
  const qs = new URLSearchParams()
  for (const [key, val] of Object.entries(params)) {
    if (val != null && val !== "") qs.set(key, val)
  }
  const query = qs.toString()
  return query ? `/api/hr/employees?${query}` : "/api/hr/employees"
}

export function EmployeeSearchSelect({
  yardId,
  includeApp,
  excludeId,
  searchPlaceholder = "Type employee no. or name…",
  placeholder = "Select employee",
  ...props
}: EmployeeSearchSelectProps) {
  const onSearch = React.useCallback(
    async (query: string): Promise<AsyncSearchSelectOption[]> => {
      const res = await fetch(
        buildEmployeesUrl({
          q: query,
          limit: "50",
          yardId,
          includeApp: includeApp ? "1" : undefined,
        }),
        { credentials: "include" },
      )
      if (!res.ok) return []
      const rows = (await res.json()) as EmployeeSelectFields[]
      return rows.filter((row) => row.id !== excludeId).map(toOption)
    },
    [yardId, includeApp, excludeId],
  )

  const resolveOption = React.useCallback(async (value: string): Promise<AsyncSearchSelectOption | null> => {
    const res = await fetch(buildEmployeesUrl({ id: value, limit: "1" }), { credentials: "include" })
    if (!res.ok) return null
    const rows = (await res.json()) as EmployeeSelectFields[]
    const row = rows.find((r) => r.id === value) ?? rows[0]
    return row ? toOption(row) : null
  }, [])

  return (
    <AsyncSearchSelect
      {...props}
      placeholder={placeholder}
      searchPlaceholder={searchPlaceholder}
      onSearch={onSearch}
      resolveOption={resolveOption}
      minSearchLength={0}
    />
  )
}

export { formatEmployeeSelectLabel }
