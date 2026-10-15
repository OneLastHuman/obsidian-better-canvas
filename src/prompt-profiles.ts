export interface NamedPromptProfile {
  id: string;
  name: string;
  prompt: string;
}

export function normalizeNamedPromptProfiles(value: unknown): NamedPromptProfile[] {
  if (!Array.isArray(value)) return [];
  const profiles: NamedPromptProfile[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const id = typeof item.id === "string" ? item.id.trim() : "";
    const name = typeof item.name === "string" ? item.name.trim() : "";
    const prompt = typeof item.prompt === "string" ? item.prompt : "";
    if (!id || !name || !prompt.trim() || seen.has(id)) continue;
    seen.add(id);
    profiles.push({ id, name, prompt });
  }
  return profiles;
}

export function upsertNamedPromptProfile(
  profiles: NamedPromptProfile[],
  nameInput: string,
  promptInput: string,
  newId: string
): NamedPromptProfile[] {
  const name = nameInput.trim();
  const prompt = promptInput.trim();
  if (!name) throw new Error("提示词名称不能为空。");
  if (!prompt) throw new Error("提示词内容不能为空。");
  const existing = profiles.find(profile => profile.name.toLocaleLowerCase() === name.toLocaleLowerCase());
  if (existing) {
    return profiles.map(profile => profile.id === existing.id ? { ...profile, name, prompt } : profile);
  }
  if (!newId.trim() || profiles.some(profile => profile.id === newId)) {
    throw new Error("新提示词标识无效或重复。");
  }
  return [...profiles, { id: newId, name, prompt }];
}

export function removeNamedPromptProfile(
  profiles: NamedPromptProfile[],
  id: string
): NamedPromptProfile[] {
  return profiles.filter(profile => profile.id !== id);
}
