import { useState } from "react";
import { AppLayout } from "./sjsu/app/layout";
import { ScholarshipsPage } from "./features/scholarships/scholarships-page";
import { ReviewsPage } from "./features/reviews/reviews-page";
import { DashboardPage } from "./features/dashboard/dashboard-page";

// no router yet — nav is a single piece of state that picks the page
export function App() {
  const [view, setView] = useState("overview");
  return (
    <AppLayout active={view} onNavigate={setView}>
      {view === "overview" && <DashboardPage />}
      {view === "scholarships" && <ScholarshipsPage />}
      {view === "reviews" && <ReviewsPage />}
    </AppLayout>
  );
}
