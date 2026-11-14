import type { ReactNode } from "react";
import { ProfileGate } from "@/features/profile/components/profile-gate";
import { getProfiles, getSelectedProfile } from "@/features/profile/current-profile";

export default async function WorkspaceLayout({ children }: { children: ReactNode }) {
  const [profiles, selected] = await Promise.all([getProfiles(), getSelectedProfile()]);
  return <ProfileGate profiles={profiles} selected={selected}>{children}</ProfileGate>;
}
