import type { Metadata } from "next";

import { Dashboard } from "@/components/recon/dashboard";

export const metadata: Metadata = { title: "Dashboard" };

export default function DashboardPage() {
  return <Dashboard />;
}
