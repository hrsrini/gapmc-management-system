"use client"

import * as React from "react"
import { Check, ChevronDown } from "lucide-react"

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

export type LocalSearchSelectOption = {
  value: string
  label: string
  keywords?: string
}

export type LocalSearchSelectProps = {
  value?: string
  onValueChange: (value: string) => void
  options: LocalSearchSelectOption[]
  placeholder?: string
  searchPlaceholder?: string
  emptyMessage?: string
  disabled?: boolean
  className?: string
  triggerClassName?: string
  allowClear?: boolean
  clearLabel?: string
  id?: string
  required?: boolean
}

/** Search-as-you-type dropdown over a local options list (same UX as Employee search). */
export function LocalSearchSelect({
  value = "",
  onValueChange,
  options,
  placeholder = "Select…",
  searchPlaceholder = "Type to search…",
  emptyMessage = "No results found.",
  disabled,
  className,
  triggerClassName,
  allowClear = false,
  clearLabel = "Clear selection",
  id,
  required,
}: LocalSearchSelectProps) {
  const [open, setOpen] = React.useState(false)

  const selected = options.find((opt) => opt.value === value)
  const display = selected?.label ?? null

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          id={id}
          type="button"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn(
            "flex h-9 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
            !display && "text-muted-foreground",
            triggerClassName,
            className,
          )}
        >
          <span className="truncate text-left">{display ?? placeholder}</span>
          <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
        <Command>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList>
            <CommandEmpty>{emptyMessage}</CommandEmpty>
            <CommandGroup>
              {allowClear && value ? (
                <CommandItem
                  value="__clear__"
                  onSelect={() => {
                    onValueChange("")
                    setOpen(false)
                  }}
                >
                  {clearLabel}
                </CommandItem>
              ) : null}
              {options.map((opt) => (
                <CommandItem
                  key={opt.value}
                  value={`${opt.label} ${opt.keywords ?? ""} ${opt.value}`}
                  onSelect={() => {
                    onValueChange(opt.value)
                    setOpen(false)
                  }}
                >
                  <Check
                    className={cn("mr-2 h-4 w-4 shrink-0", value === opt.value ? "opacity-100" : "opacity-0")}
                  />
                  <span className="truncate">{opt.label}</span>
                </CommandItem>
              ))}
            </CommandGroup>
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
