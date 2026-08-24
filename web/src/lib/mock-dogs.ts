import type { PersonalityPreference } from "./adopter-preferences";

export interface MockDogMatch {
  id: string;
  name: string;
  age: string;
  size: string;
  breedGroup: string;
  distanceMiles: number;
  matchNote: string;
  traits: PersonalityPreference[];
  colorClass: string;
  emoji: string;
}

// Deliberately isolated so a future matcher can replace this import without changing the results UI.
export const MOCK_DOG_MATCHES: readonly MockDogMatch[] = [
  {
    id: "maple",
    name: "Maple",
    age: "3 years",
    size: "Medium",
    breedGroup: "Sporting mix",
    distanceMiles: 8,
    matchNote: "A sunny walking buddy who settles in for cuddles afterward.",
    traits: ["affectionate", "playful"],
    colorClass: "dog-card-peach",
    emoji: "🐕",
  },
  {
    id: "otis",
    name: "Otis",
    age: "5 years",
    size: "Small",
    breedGroup: "Companion mix",
    distanceMiles: 14,
    matchNote: "Easygoing at home, with just enough pep for a neighborhood stroll.",
    traits: ["calm", "affectionate"],
    colorClass: "dog-card-sage",
    emoji: "🐶",
  },
  {
    id: "juniper",
    name: "Juniper",
    age: "2 years",
    size: "Large",
    breedGroup: "Working mix",
    distanceMiles: 21,
    matchNote: "Curious and confident, she loves active days and a little room to roam.",
    traits: ["playful", "independent"],
    colorClass: "dog-card-blue",
    emoji: "🐕‍🦺",
  },
];

