import type { Metadata } from "next";

import { CreateFlow } from "@/components/recon/create-flow";

export const metadata: Metadata = { title: "Create Recon" };

export default function CreatePage() {
  return <CreateFlow />;
}
