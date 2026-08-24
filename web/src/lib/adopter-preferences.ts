export const DOG_SIZES = ["small", "medium", "large", "extra-large"] as const;
export const ACTIVITY_LEVELS = ["low", "moderate", "active", "very-active"] as const;
export const EXPERIENCE_LEVELS = ["first-time", "some", "experienced"] as const;
export const PERSONALITY_PREFERENCES = ["affectionate", "playful", "calm", "independent"] as const;

export type DogSize = (typeof DOG_SIZES)[number];
export type ActivityLevel = (typeof ACTIVITY_LEVELS)[number];
export type ExperienceLevel = (typeof EXPERIENCE_LEVELS)[number];
export type PersonalityPreference = (typeof PERSONALITY_PREFERENCES)[number];

export interface AdopterPreferences {
  zipCode: string;
  maxTravelDistanceMiles: number;
  hasChildren: boolean;
  youngestChildAge: number | null;
  hasExistingDogs: boolean;
  hasExistingCats: boolean;
  maxDogSize: DogSize;
  activityLevel: ActivityLevel;
  hoursAwayPerDay: number;
  dogOwningExperience: ExperienceLevel;
  personalityPreferences: PersonalityPreference[];
}

export type PreferenceField = keyof AdopterPreferences;
export type PreferenceErrors = Partial<Record<PreferenceField, string>>;

export type ValidationResult =
  | { success: true; data: AdopterPreferences }
  | { success: false; errors: PreferenceErrors };

const isIncluded = <T extends string>(values: readonly T[], value: unknown): value is T =>
  typeof value === "string" && values.includes(value as T);

const parseBoolean = (value: unknown): boolean | null => {
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  return null;
};

const parseBoundedNumber = (value: unknown, minimum: number, maximum: number): number | null => {
  if (typeof value !== "string" && typeof value !== "number") return null;
  if (typeof value === "string" && value.trim() === "") return null;

  const parsedValue = Number(value);
  return Number.isInteger(parsedValue) && parsedValue >= minimum && parsedValue <= maximum
    ? parsedValue
    : null;
};

export function validateAdopterPreferences(input: Record<string, unknown>): ValidationResult {
  const errors: PreferenceErrors = {};
  const zipCode = typeof input.zipCode === "string" ? input.zipCode.trim() : "";
  const maxTravelDistanceMiles = parseBoundedNumber(input.maxTravelDistanceMiles, 1, 500);
  const hasChildren = parseBoolean(input.hasChildren);
  const youngestChildAge = parseBoundedNumber(input.youngestChildAge, 0, 17);
  const hasExistingDogs = parseBoolean(input.hasExistingDogs);
  const hasExistingCats = parseBoolean(input.hasExistingCats);
  const hoursAwayPerDay = parseBoundedNumber(input.hoursAwayPerDay, 0, 24);
  const personalityPreferences = Array.isArray(input.personalityPreferences)
    ? input.personalityPreferences.filter((value): value is PersonalityPreference =>
        isIncluded(PERSONALITY_PREFERENCES, value),
      )
    : [];

  if (!/^\d{5}$/.test(zipCode)) errors.zipCode = "Enter a valid 5-digit ZIP code.";
  if (maxTravelDistanceMiles === null) {
    errors.maxTravelDistanceMiles = "Choose a distance between 1 and 500 miles.";
  }
  if (hasChildren === null) errors.hasChildren = "Tell us whether children live with you.";
  if (hasChildren === true && youngestChildAge === null) {
    errors.youngestChildAge = "Enter the youngest child’s age, from 0 to 17.";
  }
  if (hasExistingDogs === null) errors.hasExistingDogs = "Tell us whether you have dogs.";
  if (hasExistingCats === null) errors.hasExistingCats = "Tell us whether you have cats.";
  if (!isIncluded(DOG_SIZES, input.maxDogSize)) errors.maxDogSize = "Choose a maximum dog size.";
  if (!isIncluded(ACTIVITY_LEVELS, input.activityLevel)) errors.activityLevel = "Choose your activity level.";
  if (hoursAwayPerDay === null) errors.hoursAwayPerDay = "Enter a whole number from 0 to 24.";
  if (!isIncluded(EXPERIENCE_LEVELS, input.dogOwningExperience)) {
    errors.dogOwningExperience = "Choose your dog-owning experience.";
  }
  if (personalityPreferences.length === 0) {
    errors.personalityPreferences = "Choose at least one personality trait.";
  }

  if (Object.keys(errors).length > 0) return { success: false, errors };

  return {
    success: true,
    data: {
      zipCode,
      maxTravelDistanceMiles: maxTravelDistanceMiles as number,
      hasChildren: hasChildren as boolean,
      youngestChildAge: hasChildren ? youngestChildAge : null,
      hasExistingDogs: hasExistingDogs as boolean,
      hasExistingCats: hasExistingCats as boolean,
      maxDogSize: input.maxDogSize as DogSize,
      activityLevel: input.activityLevel as ActivityLevel,
      hoursAwayPerDay: hoursAwayPerDay as number,
      dogOwningExperience: input.dogOwningExperience as ExperienceLevel,
      personalityPreferences,
    },
  };
}

export function formDataToPreferenceInput(formData: FormData): Record<string, unknown> {
  return {
    zipCode: formData.get("zipCode"),
    maxTravelDistanceMiles: formData.get("maxTravelDistanceMiles"),
    hasChildren: formData.get("hasChildren"),
    youngestChildAge: formData.get("youngestChildAge"),
    hasExistingDogs: formData.get("hasExistingDogs"),
    hasExistingCats: formData.get("hasExistingCats"),
    maxDogSize: formData.get("maxDogSize"),
    activityLevel: formData.get("activityLevel"),
    hoursAwayPerDay: formData.get("hoursAwayPerDay"),
    dogOwningExperience: formData.get("dogOwningExperience"),
    personalityPreferences: formData.getAll("personalityPreferences"),
  };
}

