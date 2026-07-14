import { AppLayout } from "./sjsu/app/layout";
import { ApplicationsTable } from "./features/applications/applications-table";

export function App() {
  return (
    <AppLayout>
      <ApplicationsTable />
    </AppLayout>
  );
}
