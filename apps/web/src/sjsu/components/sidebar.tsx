import { LayoutDashboard, FileText, ScrollText, Settings } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/sjsu/components/ui/tooltip";
import { Avatar, AvatarFallback } from "@/sjsu/components/ui/avatar";
import { Button } from "@/sjsu/components/ui/button";

// 52px icon rail, ported from the source app. auth/trpc stripped — the app has
// no auth yet, so nav is lifted to App (no router) and the avatar is a static initial.
const NAV_ITEMS = [
  { key: "overview", label: "Overview", icon: LayoutDashboard },
  { key: "applications", label: "Applications", icon: FileText },
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
      <aside className="flex w-[52px] flex-col items-center bg-background py-4">
        <Tooltip>
          <TooltipTrigger asChild>
            <span aria-label="Profile">
              <Avatar size="sm">
                <AvatarFallback>S</AvatarFallback>
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
                    className={
                      isActive
                        ? "bg-accent text-foreground"
                        : "text-muted-foreground"
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

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-lg"
              onClick={onOpenSettings}
              aria-label="Settings"
              className="text-muted-foreground"
            >
              <Settings className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">Settings</TooltipContent>
        </Tooltip>
      </aside>
    </TooltipProvider>
  );
}
