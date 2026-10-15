export interface ProviderProfileIdentity {
  id: string;
  name?: string | null;
}

export interface ProviderProfileDeletionResult<T extends ProviderProfileIdentity> {
  confirmed: boolean;
  activeProviderId: string | undefined;
  activeProfile?: T;
}

/** Ask before removing a provider, and report the fallback when removing the active one. */
export function confirmAndRemoveProviderProfile<T extends ProviderProfileIdentity>(
  profiles: T[],
  profileId: string,
  activeProviderId: string | undefined,
  confirmDelete: (message: string) => boolean
): ProviderProfileDeletionResult<T> {
  const index = profiles.findIndex(profile => profile.id === profileId);
  if (profiles.length <= 1 || index < 0) {
    return { confirmed: false, activeProviderId };
  }

  const profile = profiles[index];
  const isActive = activeProviderId === profile.id;
  const nextActiveProfile = isActive
    ? profiles.find((_candidate, candidateIndex) => candidateIndex !== index)
    : undefined;
  const profileName = String(profile.name || "未命名服务");
  const confirmationMessage = isActive
    ? `确定删除当前使用的 AI 服务商“${profileName}”吗？删除后将切换到“${String(nextActiveProfile?.name || "未命名服务")}”。此操作无法撤销。`
    : `确定删除 AI 服务商“${profileName}”吗？此操作无法撤销。`;

  if (!confirmDelete(confirmationMessage)) {
    return { confirmed: false, activeProviderId };
  }

  profiles.splice(index, 1);
  return {
    confirmed: true,
    activeProviderId: isActive ? nextActiveProfile?.id : activeProviderId,
    ...(isActive && nextActiveProfile ? { activeProfile: nextActiveProfile } : {})
  };
}
