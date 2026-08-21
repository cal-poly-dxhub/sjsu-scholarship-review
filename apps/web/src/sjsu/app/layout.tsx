import type { ReactNode } from "react";
import { Toaster } from "@/sjsu/components/ui/sonner";
import { Sidebar } from "@/sjsu/components/sidebar";
import { PageHeader } from "@/sjsu/components/page-header";
import { PageOutlet } from "@/sjsu/components/page-outlet";

// app shell: 52px sidebar + rounded bordered outlet card. the outlet takes
// children directly — the app has no router yet.
export function AppLayout({
  children,
  active,
  onNavigate,
}: {
  children: ReactNode;
  active: string;
  onNavigate: (key: string) => void;
}) {
  return (
    <div className="flex h-screen bg-background">
      <Sidebar active={active} onNavigate={onNavigate} />
      <div className="flex-1 overflow-hidden p-1 pl-0">
        <div className="flex h-full flex-col overflow-hidden rounded-xl border border-border bg-background">
          <PageHeader />
          <main className="flex-1 overflow-hidden overscroll-none">
            <PageOutlet bleed={active === "rubrics"}>{children}</PageOutlet>
          </main>
        </div>
      </div>
      <Toaster />
    </div>
  );
}
