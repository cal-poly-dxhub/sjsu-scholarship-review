import { useState } from "react";
import { AppLayout } from "./sjsu/app/layout";
import { ApplicationsTable } from "./features/applications/applications-table";
import { RubricsPage } from "./features/rubrics/rubrics-page";

// no router yet — nav is a single piece of state that picks the page
export function App() {
  const [view, setView] = useState("applications");
  return (
    <AppLayout active={view} onNavigate={setView}>
      {view === "rubrics" ? <RubricsPage /> : <ApplicationsTable />}
    </AppLayout>
  );
}
