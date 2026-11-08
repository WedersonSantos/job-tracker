import { getProfileDetail, getResumeFile } from "@/features/profile/api";
import { ResumeForm } from "@/features/profile/components/resume-form";
import { getSelectedProfile } from "@/features/profile/current-profile";

export default async function CurriculoPage() {
  const selected = await getSelectedProfile();

  // Sem perfil o gate mostra o modal por cima; não há currículo de ninguém.
  if (!selected) {
    return null;
  }

  const [profile, resumeFile] = await Promise.all([
    getProfileDetail(selected.id),
    getResumeFile(selected.id),
  ]);

  return <ResumeForm profile={profile} resumeFile={resumeFile} />;
}
