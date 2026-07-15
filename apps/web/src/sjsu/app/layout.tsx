import type { ReactNode } from "react";
import { Toaster } from "@/sjsu/components/ui/sonner";
import { Sidebar } from "@/sjsu/components/sidebar";
import { PageHeader } from "@/sjsu/components/page-header";
import { FramedOutlet } from "@/sjsu/components/framed-outlet";

// app shell, ported verbatim: 52px sidebar + rounded bordered outlet card.
// outlet takes children (the app has no router yet) and the marketing frame lives
// inside it via FramedOutlet. auth/settings/theme wiring stripped for now.
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
            <FramedOutlet bleed={active === "rubrics"}>{children}</FramedOutlet>
          </main>
        </div>
      </div>
      <Toaster />
    </div>
  );
}
