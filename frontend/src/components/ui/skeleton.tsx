import * as React from "react"

import { cn } from "@/lib/utils"

const Skeleton = React.forwardRef<
  HTMLDivElement,
  React.ComponentProps<"div">
>(({ className, ...props }, ref) => {
  return (
    <div
      data-slot="skeleton"
      className={cn("animate-pulse rounded-md bg-accent", className)}
      ref={ref}
      {...props}
    />
  )
})
Skeleton.displayName = "Skeleton"

export { Skeleton }
