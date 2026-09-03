import * as React from "react"

import { cn } from "@/lib/utils"

const ListRow = React.forwardRef<HTMLDivElement, React.ComponentProps<"div">>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      data-slot="list-row"
      className={cn("rounded-lg border p-3", className)}
      {...props}
    />
  )
)
ListRow.displayName = "ListRow"

export { ListRow }
