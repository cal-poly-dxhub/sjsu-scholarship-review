import {
  LayoutDashboard,
  GraduationCap,
  ClipboardCheck,
  ScrollText,
  Settings,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/sjsu/components/ui/tooltip";
import { Avatar, AvatarFallback } from "@/sjsu/components/ui/avatar";
import { Button } from "@/sjsu/components/ui/button";

// 52px icon rail. There is no router, so nav is lifted to App, and the mark at the top is the
// app's own rather than the signed-in person's.
const NAV_ITEMS = [
  { key: "overview", label: "Dashboard", icon: LayoutDashboard },
  { key: "scholarships", label: "Scholarships", icon: GraduationCap },
  { key: "reviews", label: "Review queue", icon: ClipboardCheck },
  { key: "rubrics", label: "Rubrics", icon: ScrollText },
];

export function Sidebar({
  active,
  onNavigate,
  onOpenSettings,
}: {
  active: string;
  onNavigate: (key: string) => void;
  onOpenSettings?: () => void;
}) {
  return (
    <TooltipProvider delayDuration={0}>
      <aside className="flex w-[52px] flex-col items-center py-4" style={{ backgroundColor: 'var(--sjsu-blue)' }}>
        <Tooltip>
          <TooltipTrigger asChild>
            <span aria-label="SJSU Review">
              <Avatar size="sm">
                <AvatarFallback className="bg-white/20 text-white text-xs font-bold">SJ</AvatarFallback>
              </Avatar>
            </span>
          </TooltipTrigger>
          <TooltipContent side="right">SJSU Review</TooltipContent>
        </Tooltip>

        <nav className="mt-6 flex flex-1 flex-col items-center gap-1">
          {NAV_ITEMS.map((navItem) => {
            const isActive = active === navItem.key;
            return (
              <Tooltip key={navItem.key}>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-lg"
                    onClick={() => onNavigate(navItem.key)}
                    aria-label={navItem.label}
                    className={
                      isActive
                        ? "bg-white/20 text-white"
                        : "text-white/60 hover:text-white hover:bg-white/10"
                    }
                  >
                    <navItem.icon className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="right">{navItem.label}</TooltipContent>
              </Tooltip>
            );
          })}
        </nav>

        {/* There are no settings yet. A gear that does nothing when pressed reads as broken. */}
        {onOpenSettings && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-lg"
                onClick={onOpenSettings}
                aria-label="Settings"
                className="text-white/60 hover:text-white hover:bg-white/10"
              >
                <Settings className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">Settings</TooltipContent>
          </Tooltip>
        )}
      </aside>
    </TooltipProvider>
  );
}
