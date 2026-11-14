import {
  ApplicationsPanel,
  listApplications,
  listSuggestions,
} from "@/features/applications";
import { getSelectedProfile } from "@/features/profile/current-profile";

export default async function CandidaturasPage() {
  const profile = await getSelectedProfile();

  // Sem perfil o gate mostra o modal por cima; não há o que renderizar aqui.
  if (!profile) {
    return null;
  }

  const [applications, suggestions] = await Promise.all([
    listApplications(profile.id),
    listSuggestions(profile.id),
  ]);

  return (
    <ApplicationsPanel
      profileId={profile.id}
      applications={applications}
      suggestions={suggestions}
    />
  );
}
