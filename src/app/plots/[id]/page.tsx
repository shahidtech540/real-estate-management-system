import { FullPlotPage } from "@/components/PlotBookingPanel";
export default async function PlotPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return <FullPlotPage plotId={(await params).id} />;
}
