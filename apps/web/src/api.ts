export const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3005";

// thin fetch wrapper for the python api. pair with react-query in components:
// useQuery({ queryKey: ["health"], queryFn: () => api("/health") })
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, init);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} on ${path}`);
  return res.json() as Promise<T>;
}
