import type { Metadata } from "next";

import { ReconDetail } from "@/components/recon/recon-detail";
import { reconLabel } from "@/lib/formatting/present";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  return { title: reconLabel(id) };
}

export default async function ReconPage({ params }: Props) {
  const { id } = await params;
  return <ReconDetail id={id} />;
}
