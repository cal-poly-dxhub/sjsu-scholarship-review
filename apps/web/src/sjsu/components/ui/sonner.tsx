import { Toaster as Sonner, type ToasterProps } from "sonner"
import { Spinner } from "@/sjsu/components/ui/spinner"
import IconCheck from "@/sjsu/components/icons/icon-check"
import IconCircleInfo from "@/sjsu/components/icons/icon-circle-info"
import IconTriangleWarning from "@/sjsu/components/icons/icon-triangle-warning"
import IconCircleXmark from "@/sjsu/components/icons/icon-circle-xmark"
import { useTheme } from "@/sjsu/lib/theme"

// The theme controls dark mode via the `.sjsu-theme.dark` class on the layout wrapper, not
// next-themes. Mirror that into Sonner so toasts follow the app theme, not the
// OS media query.
const Toaster = ({ ...props }: ToasterProps) => {
  const { theme } = useTheme()
  return (
    <Sonner
      theme={theme}
      className="toaster group"
      richColors
      icons={{
        success: (
          <IconCheck className="size-4" />
        ),
        info: (
          <IconCircleInfo className="size-4" />
        ),
        warning: (
          <IconTriangleWarning className="size-4" />
        ),
        error: (
          <IconCircleXmark className="size-4" />
        ),
        loading: (
          <Spinner className="size-4" />
        ),
      }}
      style={
        {
          // theme tokens are raw HSL triples - wrap with hsl() so Sonner gets a real color
          "--normal-bg": "hsl(var(--background))",
          "--normal-text": "hsl(var(--foreground))",
          "--normal-border": "hsl(var(--border))",
          "--border-radius": "1rem",
          // --success-border / --warning-border read pre-wrapped aliases from
          // sjsu.css - sonner's own vars share those names, so writing
          // `hsl(var(--success-border))` here would self-reference. The bg
          // vars don't collide, so they're inlined like --error-bg below.
          "--success-bg": "hsl(var(--success))",
          "--success-text": "white",
          "--success-border": "var(--success-border-hsl)",
          "--error-bg": "hsl(var(--destructive))",
          "--error-text": "white",
          "--error-border": "hsl(var(--destructive-border))",
          "--warning-bg": "hsl(var(--warning))",
          "--warning-text": "black",
          "--warning-border": "var(--warning-border-hsl)",
          "--info-bg": "hsl(var(--background))",
          "--info-text": "hsl(var(--foreground))",
          "--info-border": "hsl(var(--border))",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "cn-toast",
          description: "!text-inherit opacity-80",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
