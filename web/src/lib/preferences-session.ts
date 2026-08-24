import { validateAdopterPreferences, type AdopterPreferences } from "./adopter-preferences";

const STORAGE_KEY = "pet-connect:adopter-preferences";

export function savePreferences(preferences: AdopterPreferences): boolean {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
    return true;
  } catch {
    return false;
  }
}

export function loadPreferences(): AdopterPreferences | null {
  try {
    const savedPreferences = window.sessionStorage.getItem(STORAGE_KEY);
    if (!savedPreferences) return null;

    const parsedPreferences: unknown = JSON.parse(savedPreferences);
    if (typeof parsedPreferences !== "object" || parsedPreferences === null || Array.isArray(parsedPreferences)) {
      return null;
    }

    const result = validateAdopterPreferences(parsedPreferences as Record<string, unknown>);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

