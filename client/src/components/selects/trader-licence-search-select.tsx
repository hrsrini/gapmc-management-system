"use client"

import * as React from "react"

import {
  AsyncSearchSelect,
  type AsyncSearchSelectOption,
  type AsyncSearchSelectProps,
} from "@/components/ui/async-search-select"
import {
  formatTraderLicenceSelectLabel,
  type TraderLicenceSelectFields,
} from "@shared/select-display-labels"

export type TraderLicenceSearchSelectProps = Omit<
  AsyncSearchSelectProps,
  "onSearch" | "resolveOption" | "searchPlaceholder"
> & {
  yardId?: string
  status?: string
  licenceTypes?: string[]
  lmLinked?: boolean
  lmActive?: boolean
  allYards?: boolean
  excludeId?: string
  searchPlaceholder?: string
}

function toOption(licence: TraderLicenceSelectFields): AsyncSearchSelectOption {
  const label = formatTraderLicenceSelectLabel(licence)
  return {
    value: licence.id,
    label,
    keywords: label,
  }
}

function buildLicencesUrl(params: Record<string, string | undefined>): string {
  const qs = new URLSearchParams()
  for (const [key, val] of Object.entries(params)) {
    if (val != null && val !== "") qs.set(key, val)
  }
  const query = qs.toString()
  return query ? `/api/ioms/traders/licences?${query}` : "/api/ioms/traders/licences"
}

export function TraderLicenceSearchSelect({
  yardId,
  status,
  licenceTypes,
  lmLinked,
  lmActive,
  allYards,
  excludeId,
  searchPlaceholder = "Type license no. or trader name…",
  placeholder = "Select trader licence",
  ...props
}: TraderLicenceSearchSelectProps) {
  const licenceTypesParam = licenceTypes?.length ? licenceTypes.join(",") : undefined

  const onSearch = React.useCallback(
    async (query: string): Promise<AsyncSearchSelectOption[]> => {
      const res = await fetch(
        buildLicencesUrl({
          q: query,
          limit: "50",
          yardId,
          status,
          licenceTypes: licenceTypesParam,
          lmLinked: lmLinked ? "1" : undefined,
          lmActive: lmActive ? "1" : undefined,
          allYards: allYards ? "1" : undefined,
        }),
        { credentials: "include" },
      )
      if (!res.ok) return []
      const rows = (await res.json()) as TraderLicenceSelectFields[]
      return rows.filter((row) => row.id !== excludeId).map(toOption)
    },
    [yardId, status, licenceTypesParam, lmLinked, lmActive, allYards, excludeId],
  )

  const resolveOption = React.useCallback(async (value: string): Promise<AsyncSearchSelectOption | null> => {
    const res = await fetch(buildLicencesUrl({ id: value, limit: "1" }), { credentials: "include" })
    if (!res.ok) return null
    const rows = (await res.json()) as TraderLicenceSelectFields[]
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

export { formatTraderLicenceSelectLabel }
