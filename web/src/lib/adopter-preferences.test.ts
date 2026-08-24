import { describe, expect, it } from "vitest";

import { validateAdopterPreferences } from "./adopter-preferences";

const validInput = {
  zipCode: "10001",
  maxTravelDistanceMiles: "25",
  hasChildren: "false",
  youngestChildAge: "",
  hasExistingDogs: "true",
  hasExistingCats: "false",
  maxDogSize: "medium",
  activityLevel: "moderate",
  hoursAwayPerDay: "6",
  dogOwningExperience: "some",
  personalityPreferences: ["affectionate", "calm"],
};

describe("validateAdopterPreferences", () => {
  it("returns a typed preference model for valid input", () => {
    const result = validateAdopterPreferences(validInput);

    expect(result).toEqual({
      success: true,
      data: {
        zipCode: "10001",
        maxTravelDistanceMiles: 25,
        hasChildren: false,
        youngestChildAge: null,
        hasExistingDogs: true,
        hasExistingCats: false,
        maxDogSize: "medium",
        activityLevel: "moderate",
        hoursAwayPerDay: 6,
        dogOwningExperience: "some",
        personalityPreferences: ["affectionate", "calm"],
      },
    });
  });

  it("requires a valid youngest age when children live at home", () => {
    const result = validateAdopterPreferences({ ...validInput, hasChildren: "true", youngestChildAge: "" });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.errors.youngestChildAge).toMatch(/youngest child/i);
  });

  it("rejects invalid ranges, unknown enums, and an empty personality selection", () => {
    const result = validateAdopterPreferences({
      ...validInput,
      zipCode: "12",
      hoursAwayPerDay: "25",
      maxDogSize: "giant",
      personalityPreferences: [],
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors).toMatchObject({
        zipCode: expect.any(String),
        hoursAwayPerDay: expect.any(String),
        maxDogSize: expect.any(String),
        personalityPreferences: expect.any(String),
      });
    }
  });
});

