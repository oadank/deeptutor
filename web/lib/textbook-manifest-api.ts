import { apiFetch } from "@/lib/api";

export interface TextbookManifest {
  updated_at: number;
  general_md: string;
  provinces: Record<string, { hs: string; ps: string }>;
  sample_md: string;
}

export async function getTextbookManifest(): Promise<TextbookManifest> {
  const res = await apiFetch("/api/textbook-manifest");
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  return res.json();
}
