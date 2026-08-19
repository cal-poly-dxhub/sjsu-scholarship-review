import React, { useState } from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { registerWrapper } from "./sjsu/lib/theme";
import { restoreSession, signIn } from "./auth";
import { App } from "./App";
import "./index.css";
import "./globals.css";
import "./App.css";
import "./assets/fonts/stylesheet.css";

function Root() {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <QueryClientProvider client={queryClient}>
      {/* sjsu.css theme is scoped to this wrapper. registerWrapper lets the theme
          store toggle `.dark` on it imperatively (no re-render on flip). */}
      <div ref={(el) => registerWrapper(el)} className="sjsu-theme">
        <App />
      </div>
    </QueryClientProvider>
  );
}

// Sign-in is settled before anything renders, so a signed-out visitor sees no application data
// on the way to the hosted page.
void restoreSession().then((signedIn) => {
  if (!signedIn) {
    void signIn();
    return;
  }
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <Root />
    </React.StrictMode>,
  );
});
