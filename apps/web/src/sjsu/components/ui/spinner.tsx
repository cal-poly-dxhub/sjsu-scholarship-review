import { cn } from "@/sjsu/lib/utils"
import IconLoader from "@/sjsu/components/icons/icon-loader"

// Original lucide spinner - uncomment to revert
// import { Loader2Icon } from "lucide-react"
// function Spinner({ className, ...props }: React.ComponentProps<"svg">) {
//   return (
//     <Loader2Icon role="status" aria-label="Loading" className={cn("size-4 animate-spin", className)} {...props} />
//   )
// }

function Spinner({ className, ...props }: React.ComponentProps<"svg">) {
  return (
    <IconLoader role="status" aria-label="Loading" size="16px" className={cn(className)} {...props} />
  )
}

export { Spinner }
