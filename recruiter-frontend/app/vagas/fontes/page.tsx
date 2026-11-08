import { getSourceOverview, listSavedJobs } from "@/features/jobs/api";
import { getSelectedProfile } from "@/features/profile/current-profile";
import { JobsTabs } from "@/features/jobs/components/jobs-tabs";
import { SourcesSettings } from "@/features/jobs/components/sources-settings";

export default async function SourcesPage() {
  const selected = await getSelectedProfile();
  if (!selected) return null;
  const [overview, saved] = await Promise.all([
    getSourceOverview(),
    listSavedJobs(selected.id),
  ]);
  return (
    <div className="mx-auto flex w-full max-w-[110rem] flex-col gap-6 pb-12">
      <JobsTabs savedCount={saved.length} />
      <SourcesSettings initial={overview} />
    </div>
  );
}
