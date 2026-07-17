import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/api";
import { ApplicationsList } from "./applications-list";
import { ApplicationDetail } from "./application-detail";

interface ScholarshipsResponse {
  scholarships: string[];
}

export function ScholarshipsPage() {
  const [selectedScholarship, setSelectedScholarship] = useState<string | null>(null);
  const [selectedAppKey, setSelectedAppKey] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["scholarships"],
    queryFn: () => api<ScholarshipsResponse>("/scholarships"),
  });

  // Detail view for a specific application
  if (selectedAppKey) {
    return (
      <ApplicationDetail
        applicationKey={selectedAppKey}
        onBack={() => setSelectedAppKey(null)}
      />
    );
  }

  // Applications list for a selected scholarship
  if (selectedScholarship) {
    return (
      <ApplicationsList
        availabilityId={selectedScholarship}
        onBack={() => setSelectedScholarship(null)}
        onSelectApp={setSelectedAppKey}
      />
    );
  }

  // Scholarship list
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Scholarships</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Select a scholarship to view ranked applications.
        </p>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : (
        <div className="space-y-2">
          {data?.scholarships.map((scholarship) => (
            <button
              key={scholarship}
              onClick={() => setSelectedScholarship(scholarship)}
              className="w-full text-left px-4 py-3 rounded-lg border border-border hover:bg-accent/50 transition-colors"
            >
              <span className="font-medium">{scholarship}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
