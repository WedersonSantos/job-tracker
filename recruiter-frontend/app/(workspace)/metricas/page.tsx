import { getMetrics, MetricsPanel } from "@/features/metrics";
import { getSelectedProfile } from "@/features/profile/current-profile";

export default async function MetricasPage() {
  const profile = await getSelectedProfile();

  // Sem perfil o gate mostra o modal por cima; não há o que renderizar aqui.
  if (!profile) {
    return null;
  }

  const metrics = await getMetrics(profile.id);

  return <MetricsPanel metrics={metrics} />;
}
