"use client"

import * as React from "react"
import { Check, ChevronDown, Loader2 } from "lucide-react"

import { cn } from "@/lib/utils"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"

export type AsyncSearchSelectOption = {
  value: string
  label: string
  keywords?: string
}

export type AsyncSearchSelectProps = {
  value?: string
  onValueChange: (value: string) => void
  onSearch: (query: string) => Promise<AsyncSearchSelectOption[]>
  resolveOption?: (value: string) => Promise<AsyncSearchSelectOption | null>
  placeholder?: string
  searchPlaceholder?: string
  emptyMessage?: string
  disabled?: boolean
  className?: string
  triggerClassName?: string
  minSearchLength?: number
  debounceMs?: number
  allowClear?: boolean
  clearLabel?: string
  id?: string
  required?: boolean
}

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = React.useState(value)
  React.useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs)
    return () => window.clearTimeout(timer)
  }, [value, delayMs])
  return debounced
}

export function AsyncSearchSelect({
  value = "",
  onValueChange,
  onSearch,
  resolveOption,
  placeholder = "Select…",
  searchPlaceholder = "Type to search…",
  emptyMessage = "No results found.",
  disabled,
  className,
  triggerClassName,
  minSearchLength = 0,
  debounceMs = 250,
  allowClear = false,
  clearLabel = "Clear selection",
  id,
  required,
}: AsyncSearchSelectProps) {
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState("")
  const [options, setOptions] = React.useState<AsyncSearchSelectOption[]>([])
  const [loading, setLoading] = React.useState(false)
  const [selectedLabel, setSelectedLabel] = React.useState<string | null>(null)
  const debouncedQuery = useDebouncedValue(query, debounceMs)
  const requestIdRef = React.useRef(0)
  const onSearchRef = React.useRef(onSearch)
  onSearchRef.current = onSearch

  React.useEffect(() => {
    if (!value) {
      setSelectedLabel(null)
      return
    }
    const cached = options.find((opt) => opt.value === value)
    if (cached) {
      setSelectedLabel(cached.label)
      return
    }
    if (!resolveOption) return
    let cancelled = false
    void resolveOption(value).then((resolved) => {
      if (!cancelled && resolved) setSelectedLabel(resolved.label)
    })
    return () => {
      cancelled = true
    }
  }, [value, options, resolveOption])

  const runSearch = React.useCallback((searchQuery: string) => {
    const trimmed = searchQuery.trim()
    if (minSearchLength > 0 && trimmed.length < minSearchLength) {
      setOptions([])
      setLoading(false)
      return
    }
    const requestId = ++requestIdRef.current
    setLoading(true)
    void onSearchRef.current(trimmed).then((results) => {
      if (requestId !== requestIdRef.current) return
      setOptions(results)
      setLoading(false)
      if (value) {
        const match = results.find((opt) => opt.value === value)
        if (match) setSelectedLabel(match.label)
      }
    })
  }, [minSearchLength, value])

  React.useEffect(() => {
    if (!open) return
    runSearch(debouncedQuery)
  }, [open, debouncedQuery, runSearch])

  const handleOpenChange = React.useCallback(
    (next: boolean) => {
      setOpen(next)
      if (next) runSearch(query.trim())
    },
    [query, runSearch],
  )

  React.useEffect(() => {
    if (!open) setQuery("")
  }, [open])

  const handleSelect = (next: string) => {
    if (next === "__clear__") {
      onValueChange("")
      setSelectedLabel(null)
      setOpen(false)
      return
    }
    const picked = options.find((opt) => opt.value === next)
    onValueChange(next)
    setSelectedLabel(picked?.label ?? next)
    setOpen(false)
  }

  const showMinLengthHint = minSearchLength > 0 && query.trim().length < minSearchLength

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          id={id}
          type="button"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn(
            "flex h-9 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
            !selectedLabel && !value && "text-muted-foreground",
            triggerClassName,
            className,
          )}
        >
          <span className="truncate text-left">{selectedLabel ?? (value || placeholder)}</span>
          <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder={searchPlaceholder}
            value={query}
            onValueChange={setQuery}
            autoFocus
          />
          <CommandList>
            {loading ? (
              <div className="flex items-center gap-2 px-3 py-4 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Searching…
              </div>
            ) : showMinLengthHint ? (
              <div className="px-3 py-4 text-sm text-muted-foreground">
                Type at least {minSearchLength} characters to search.
              </div>
            ) : options.length === 0 ? (
              <CommandEmpty>{emptyMessage}</CommandEmpty>
            ) : (
              <CommandGroup>
                {allowClear && value ? (
                  <CommandItem value="__clear__" onSelect={() => handleSelect("__clear__")}>
                    {clearLabel}
                  </CommandItem>
                ) : null}
                {options.map((opt) => (
                  <CommandItem key={opt.value} value={opt.value} onSelect={handleSelect}>
                    <Check className={cn("h-4 w-4 shrink-0", value === opt.value ? "opacity-100" : "opacity-0")} />
                    <span className="truncate">{opt.label}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
      {required ? (
        <input
          type="text"
          tabIndex={-1}
          aria-hidden
          className="sr-only"
          value={value}
          required
          onChange={() => {}}
        />
      ) : null}
    </Popover>
  )
}
