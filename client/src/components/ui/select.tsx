"use client"

import * as React from "react"
import { Check, ChevronDown } from "lucide-react"

import { cn } from "@/lib/utils"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command"

type SelectItemData = {
  value: string
  label: React.ReactNode
  disabled?: boolean
  searchText: string
}

type SelectGroupData = {
  label?: React.ReactNode
  items: SelectItemData[]
}

type SelectContextValue = {
  value?: string
  onValueChange?: (value: string) => void
  open: boolean
  setOpen: (open: boolean) => void
  disabled?: boolean
  placeholder?: string
  setPlaceholder: (placeholder?: string) => void
  items: SelectItemData[]
  setItems: (items: SelectItemData[]) => void
  groups: SelectGroupData[]
  setGroups: (groups: SelectGroupData[]) => void
}

const SelectContext = React.createContext<SelectContextValue | null>(null)

function useSelectContext(name: string) {
  const ctx = React.useContext(SelectContext)
  if (!ctx) throw new Error(`${name} must be used within Select`)
  return ctx
}

function extractSearchText(node: React.ReactNode): string {
  if (node == null || typeof node === "boolean") return ""
  if (typeof node === "string" || typeof node === "number") return String(node)
  if (Array.isArray(node)) return node.map(extractSearchText).join(" ")
  if (React.isValidElement(node)) return extractSearchText(node.props.children)
  return ""
}

function parseSelectContentChildren(children: React.ReactNode): { items: SelectItemData[]; groups: SelectGroupData[] } {
  const items: SelectItemData[] = []
  const groups: SelectGroupData[] = []

  React.Children.forEach(children, (child) => {
    if (!React.isValidElement(child)) return
    const childType = child.type as { displayName?: string }

    if (childType.displayName === "SelectGroup") {
      const groupItems: SelectItemData[] = []
      let groupLabel: React.ReactNode | undefined
      React.Children.forEach(child.props.children, (groupChild) => {
        if (!React.isValidElement(groupChild)) return
        const groupChildType = groupChild.type as { displayName?: string }
        const groupProps = groupChild.props as {
          children?: React.ReactNode
          value?: string
          disabled?: boolean
        }
        if (groupChildType.displayName === "SelectLabel") {
          groupLabel = groupProps.children
        } else if (groupChildType.displayName === "SelectItem") {
          const label = groupProps.children
          groupItems.push({
            value: String(groupProps.value),
            label,
            disabled: groupProps.disabled,
            searchText: extractSearchText(label),
          })
        }
      })
      if (groupItems.length > 0) groups.push({ label: groupLabel, items: groupItems })
      items.push(...groupItems)
      return
    }

    if (childType.displayName === "SelectItem") {
      const itemProps = child.props as {
        children?: React.ReactNode
        value?: string
        disabled?: boolean
      }
      const label = itemProps.children
      items.push({
        value: String(itemProps.value),
        label,
        disabled: itemProps.disabled,
        searchText: extractSearchText(label),
      })
    }
  })

  return { items, groups }
}

type SelectProps = {
  value?: string
  defaultValue?: string
  onValueChange?: (value: string) => void
  disabled?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
  children: React.ReactNode
  required?: boolean
  name?: string
}

const Select = ({
  value,
  defaultValue,
  onValueChange,
  disabled,
  open: openProp,
  onOpenChange,
  children,
}: SelectProps) => {
  const [internalValue, setInternalValue] = React.useState(defaultValue ?? "")
  const [internalOpen, setInternalOpen] = React.useState(false)
  const [placeholder, setPlaceholder] = React.useState<string | undefined>()
  const [items, setItems] = React.useState<SelectItemData[]>([])
  const [groups, setGroups] = React.useState<SelectGroupData[]>([])

  const isControlled = value !== undefined
  const currentValue = isControlled ? value : internalValue
  const open = openProp ?? internalOpen

  const setOpen = React.useCallback(
    (next: boolean) => {
      onOpenChange?.(next)
      if (openProp === undefined) setInternalOpen(next)
    },
    [onOpenChange, openProp],
  )

  const handleValueChange = React.useCallback(
    (next: string) => {
      if (!isControlled) setInternalValue(next)
      onValueChange?.(next)
      setOpen(false)
    },
    [isControlled, onValueChange, setOpen],
  )

  const ctx = React.useMemo<SelectContextValue>(
    () => ({
      value: currentValue,
      onValueChange: handleValueChange,
      open,
      setOpen,
      disabled,
      placeholder,
      setPlaceholder,
      items,
      setItems,
      groups,
      setGroups,
    }),
    [currentValue, handleValueChange, open, setOpen, disabled, placeholder, items, groups],
  )

  return (
    <SelectContext.Provider value={ctx}>
      <Popover open={open} onOpenChange={setOpen}>
        {children}
      </Popover>
    </SelectContext.Provider>
  )
}

const SelectGroup = ({ children }: { children: React.ReactNode }) => <>{children}</>
SelectGroup.displayName = "SelectGroup"

const SelectValue = ({ placeholder }: { placeholder?: string }) => {
  const { setPlaceholder } = useSelectContext("SelectValue")
  React.useEffect(() => {
    setPlaceholder(placeholder)
  }, [placeholder, setPlaceholder])
  return null
}
SelectValue.displayName = "SelectValue"

const SelectTrigger = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement>
>(({ className, children, ...props }, ref) => {
  const { value, open, disabled, placeholder, items } = useSelectContext("SelectTrigger")
  const selected = items.find((item) => item.value === value)
  const display = selected?.label ?? (value ? value : null)

  return (
    <PopoverTrigger asChild>
      <button
        ref={ref}
        type="button"
        role="combobox"
        aria-expanded={open}
        disabled={disabled}
        className={cn(
          "flex h-9 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 [&>span]:line-clamp-1",
          !display && "text-muted-foreground",
          className,
        )}
        {...props}
      >
        <span className="truncate text-left">{display ?? placeholder ?? "Select…"}</span>
        <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
        {children}
      </button>
    </PopoverTrigger>
  )
})
SelectTrigger.displayName = "SelectTrigger"

type SelectContentProps = React.ComponentPropsWithoutRef<typeof PopoverContent> & {
  searchable?: boolean
  searchPlaceholder?: string
  position?: "popper" | "item-aligned"
}

const SelectContent = React.forwardRef<HTMLDivElement, SelectContentProps>(
  (
    {
      className,
      children,
      searchable = true,
      searchPlaceholder = "Type to search…",
      align = "start",
      sideOffset = 4,
      position = "popper",
      ...props
    },
    ref,
  ) => {
    const { value, onValueChange, open, setItems, setGroups, items, groups } = useSelectContext("SelectContent")

    React.useLayoutEffect(() => {
      const parsed = parseSelectContentChildren(children)
      setItems(parsed.items)
      setGroups(parsed.groups)
    }, [children, setItems, setGroups])

    if (!open) return null

    const hasGroups = groups.length > 0

    return (
      <PopoverContent
        ref={ref}
        align={align}
        sideOffset={sideOffset}
        className={cn(
          "w-[var(--radix-popover-trigger-width)] min-w-[8rem] p-0",
          position === "popper" && "translate-y-1",
          className,
        )}
        {...props}
      >
        <Command shouldFilter={searchable}>
          {searchable ? <CommandInput placeholder={searchPlaceholder} autoFocus /> : null}
          <CommandList>
            <CommandEmpty>No results found.</CommandEmpty>
            {hasGroups
              ? groups.map((group, index) => (
                  <React.Fragment key={index}>
                    {index > 0 ? <CommandSeparator /> : null}
                    <CommandGroup heading={group.label ? String(group.label) : undefined}>
                      {group.items.map((item) => (
                        <SelectCommandItem
                          key={item.value}
                          item={item}
                          selected={value === item.value}
                          onSelect={onValueChange}
                        />
                      ))}
                    </CommandGroup>
                  </React.Fragment>
                ))
              : items.map((item) => (
                  <SelectCommandItem
                    key={item.value}
                    item={item}
                    selected={value === item.value}
                    onSelect={onValueChange}
                  />
                ))}
          </CommandList>
        </Command>
      </PopoverContent>
    )
  },
)
SelectContent.displayName = "SelectContent"

function SelectCommandItem({
  item,
  selected,
  onSelect,
}: {
  item: SelectItemData
  selected: boolean
  onSelect?: (value: string) => void
}) {
  return (
    <CommandItem
      value={`${item.value} ${item.searchText}`}
      disabled={item.disabled}
      onSelect={() => onSelect?.(item.value)}
    >
      <Check className={cn("h-4 w-4", selected ? "opacity-100" : "opacity-0")} />
      <span className="truncate">{item.label}</span>
    </CommandItem>
  )
}

const SelectLabel = ({ children, className }: { children: React.ReactNode; className?: string }) => (
  <span className={cn("hidden", className)}>{children}</span>
)
SelectLabel.displayName = "SelectLabel"

const SelectItem = ({
  value: _value,
  children: _children,
  disabled: _disabled,
}: {
  value: string
  children: React.ReactNode
  disabled?: boolean
}) => null
SelectItem.displayName = "SelectItem"

const SelectSeparator = () => null
SelectSeparator.displayName = "SelectSeparator"

const SelectScrollUpButton = () => null
SelectScrollUpButton.displayName = "SelectScrollUpButton"

const SelectScrollDownButton = () => null
SelectScrollDownButton.displayName = "SelectScrollDownButton"

export {
  Select,
  SelectGroup,
  SelectValue,
  SelectTrigger,
  SelectContent,
  SelectLabel,
  SelectItem,
  SelectSeparator,
  SelectScrollUpButton,
  SelectScrollDownButton,
}
