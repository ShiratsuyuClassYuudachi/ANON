import * as React from "react"
import { Popover as PopoverPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

function Popover({
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Root>) {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />
}

const PopoverTrigger = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Trigger>,
  React.ComponentProps<typeof PopoverPrimitive.Trigger>
>(({ ...props }, ref) => {
  return (
    <PopoverPrimitive.Trigger
      data-slot="popover-trigger"
      ref={ref}
      {...props}
    />
  )
})
PopoverTrigger.displayName = "PopoverTrigger"

const PopoverContent = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Content>,
  React.ComponentProps<typeof PopoverPrimitive.Content>
>(({ className, align = "center", sideOffset = 4, ...props }, ref) => {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        data-slot="popover-content"
        align={align}
        sideOffset={sideOffset}
        className={cn(
          "z-50 w-72 origin-(--radix-popover-content-transform-origin) rounded-md border bg-popover p-4 text-popover-foreground shadow-md outline-hidden data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
          className
        )}
        ref={ref}
        {...props}
      />
    </PopoverPrimitive.Portal>
  )
})
PopoverContent.displayName = "PopoverContent"

const PopoverAnchor = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Anchor>,
  React.ComponentProps<typeof PopoverPrimitive.Anchor>
>(({ ...props }, ref) => {
  return (
    <PopoverPrimitive.Anchor
      data-slot="popover-anchor"
      ref={ref}
      {...props}
    />
  )
})
PopoverAnchor.displayName = "PopoverAnchor"

const PopoverHeader = React.forwardRef<
  HTMLDivElement,
  React.ComponentProps<"div">
>(({ className, ...props }, ref) => {
  return (
    <div
      data-slot="popover-header"
      className={cn("flex flex-col gap-1 text-sm", className)}
      ref={ref}
      {...props}
    />
  )
})
PopoverHeader.displayName = "PopoverHeader"

const PopoverTitle = React.forwardRef<
  HTMLDivElement,
  React.ComponentProps<"h2">
>(({ className, ...props }, ref) => {
  return (
    <div
      data-slot="popover-title"
      className={cn("font-medium", className)}
      ref={ref}
      {...props}
    />
  )
})
PopoverTitle.displayName = "PopoverTitle"

const PopoverDescription = React.forwardRef<
  HTMLParagraphElement,
  React.ComponentProps<"p">
>(({ className, ...props }, ref) => {
  return (
    <p
      data-slot="popover-description"
      className={cn("text-muted-foreground", className)}
      ref={ref}
      {...props}
    />
  )
})
PopoverDescription.displayName = "PopoverDescription"

export {
  Popover,
  PopoverTrigger,
  PopoverContent,
  PopoverAnchor,
  PopoverHeader,
  PopoverTitle,
  PopoverDescription,
}
