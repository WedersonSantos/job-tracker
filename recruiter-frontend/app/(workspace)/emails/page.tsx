import { listApplications } from "@/features/applications";
import { getEmailStatus, listUnlinkedEmails, UnlinkedInbox } from "@/features/emails";
import { getSelectedProfile } from "@/features/profile/current-profile";

/**
 * A caixa de emails pendentes.
 *
 * Os emails não são filtrados por perfil — há uma conta de email e vários
 * perfis —, mas as candidaturas para vincular e o perfil que receberá uma nova
 * candidatura são do perfil selecionado.
 */
export default async function EmailsPage() {
  const profile = await getSelectedProfile();

  if (!profile) {
    return null;
  }

  const [emails, applications, status] = await Promise.all([
    listUnlinkedEmails(),
    listApplications(profile.id),
    getEmailStatus(),
  ]);

  return (
    <UnlinkedInbox
      profileId={profile.id}
      emails={emails}
      applications={applications}
      status={status}
    />
  );
}
