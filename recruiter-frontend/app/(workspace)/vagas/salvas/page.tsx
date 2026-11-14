import { SavedJobsList, listSavedJobs } from "@/features/jobs";
import { getSelectedProfile } from "@/features/profile/current-profile";

export default async function MinhasVagasPage() {
  const profile = await getSelectedProfile();

  if (!profile) {
    return null;
  }

  const saved = await listSavedJobs(profile.id);

  return <SavedJobsList profileId={profile.id} saved={saved} />;
}
