"use client";

import { useState, type FormEvent } from "react";

import {
  formDataToPreferenceInput,
  validateAdopterPreferences,
  type AdopterPreferences,
  type PreferenceErrors,
} from "@/lib/adopter-preferences";

interface PreferencesFormProps {
  onValidPreferences: (preferences: AdopterPreferences) => void;
  submissionError?: string | null;
}

const BinaryChoice = ({
  legend,
  name,
  error,
}: {
  legend: string;
  name: "hasChildren" | "hasExistingDogs" | "hasExistingCats";
  error?: string;
}) => (
  <fieldset className="question-group" aria-describedby={error ? `${name}-error` : undefined}>
    <legend>{legend}</legend>
    <div className="choice-row">
      <label className="choice-pill"><input type="radio" name={name} value="true" /> Yes</label>
      <label className="choice-pill"><input type="radio" name={name} value="false" /> No</label>
    </div>
    {error && <p className="field-error" id={`${name}-error`}>{error}</p>}
  </fieldset>
);

export function PreferencesForm({ onValidPreferences, submissionError }: PreferencesFormProps) {
  const [errors, setErrors] = useState<PreferenceErrors>({});
  const [hasChildren, setHasChildren] = useState(false);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const result = validateAdopterPreferences(
      formDataToPreferenceInput(new FormData(event.currentTarget)),
    );

    if (!result.success) {
      setErrors(result.errors);
      window.requestAnimationFrame(() => {
        document.querySelector<HTMLElement>(".field-error")?.focus();
      });
      return;
    }

    setErrors({});
    onValidPreferences(result.data);
  };

  return (
    <form
      className="preferences-form"
      onSubmit={handleSubmit}
      onChange={(event) => {
        if (!(event.target instanceof HTMLInputElement)) return;
        const target = event.target;
        if (target.name === "hasChildren") setHasChildren(target.value === "true");
      }}
      noValidate
    >
      {(Object.keys(errors).length > 0 || submissionError) && (
        <div className="error-summary" role="alert">
          {submissionError ?? "Please check the highlighted answers and try again."}
        </div>
      )}

      <section className="form-section" aria-labelledby="location-heading">
        <div className="section-number">1</div>
        <div className="section-content">
          <h2 id="location-heading">Where should we look?</h2>
          <p className="section-help">We’ll keep your matches comfortably within reach.</p>
          <div className="two-column-fields">
            <label className="field-label">
              ZIP code
              <input name="zipCode" inputMode="numeric" autoComplete="postal-code" maxLength={5} aria-invalid={Boolean(errors.zipCode)} />
              {errors.zipCode && <span className="field-error" tabIndex={-1}>{errors.zipCode}</span>}
            </label>
            <label className="field-label">
              Maximum travel distance
              <select name="maxTravelDistanceMiles" defaultValue="" aria-invalid={Boolean(errors.maxTravelDistanceMiles)}>
                <option value="" disabled>Choose a distance</option>
                <option value="10">10 miles</option>
                <option value="25">25 miles</option>
                <option value="50">50 miles</option>
                <option value="100">100 miles</option>
                <option value="250">Anywhere within 250 miles</option>
              </select>
              {errors.maxTravelDistanceMiles && <span className="field-error" tabIndex={-1}>{errors.maxTravelDistanceMiles}</span>}
            </label>
          </div>
        </div>
      </section>

      <section className="form-section" aria-labelledby="household-heading">
        <div className="section-number">2</div>
        <div className="section-content">
          <h2 id="household-heading">Tell us about your household</h2>
          <p className="section-help">These answers help us prioritize safe, comfortable matches.</p>
          <BinaryChoice legend="Do children live with you?" name="hasChildren" error={errors.hasChildren} />
          {hasChildren && (
            <label className="field-label compact-field">
              Youngest child’s age
              <input name="youngestChildAge" type="number" min="0" max="17" inputMode="numeric" aria-invalid={Boolean(errors.youngestChildAge)} />
              {errors.youngestChildAge && <span className="field-error" tabIndex={-1}>{errors.youngestChildAge}</span>}
            </label>
          )}
          <div className="two-column-fields household-grid">
            <BinaryChoice legend="Do you have dogs?" name="hasExistingDogs" error={errors.hasExistingDogs} />
            <BinaryChoice legend="Do you have cats?" name="hasExistingCats" error={errors.hasExistingCats} />
          </div>
        </div>
      </section>

      <section className="form-section" aria-labelledby="routine-heading">
        <div className="section-number">3</div>
        <div className="section-content">
          <h2 id="routine-heading">What does everyday life look like?</h2>
          <div className="two-column-fields">
            <label className="field-label">
              Maximum dog size
              <select name="maxDogSize" defaultValue="" aria-invalid={Boolean(errors.maxDogSize)}>
                <option value="" disabled>Choose a size</option>
                <option value="small">Small · under 25 lbs</option>
                <option value="medium">Medium · up to 50 lbs</option>
                <option value="large">Large · up to 80 lbs</option>
                <option value="extra-large">Any size</option>
              </select>
              {errors.maxDogSize && <span className="field-error" tabIndex={-1}>{errors.maxDogSize}</span>}
            </label>
            <label className="field-label">
              Your activity level
              <select name="activityLevel" defaultValue="" aria-invalid={Boolean(errors.activityLevel)}>
                <option value="" disabled>Choose a level</option>
                <option value="low">Low-key · short strolls</option>
                <option value="moderate">Moderate · daily walks</option>
                <option value="active">Active · long walks or runs</option>
                <option value="very-active">Very active · outdoor adventures</option>
              </select>
              {errors.activityLevel && <span className="field-error" tabIndex={-1}>{errors.activityLevel}</span>}
            </label>
            <label className="field-label">
              Hours away from home each day
              <input name="hoursAwayPerDay" type="number" min="0" max="24" inputMode="numeric" placeholder="For example, 6" aria-invalid={Boolean(errors.hoursAwayPerDay)} />
              {errors.hoursAwayPerDay && <span className="field-error" tabIndex={-1}>{errors.hoursAwayPerDay}</span>}
            </label>
            <label className="field-label">
              Dog-owning experience
              <select name="dogOwningExperience" defaultValue="" aria-invalid={Boolean(errors.dogOwningExperience)}>
                <option value="" disabled>Choose your experience</option>
                <option value="first-time">This would be my first dog</option>
                <option value="some">I’ve lived with a dog before</option>
                <option value="experienced">I’m an experienced dog owner</option>
              </select>
              {errors.dogOwningExperience && <span className="field-error" tabIndex={-1}>{errors.dogOwningExperience}</span>}
            </label>
          </div>
        </div>
      </section>

      <section className="form-section" aria-labelledby="personality-heading">
        <div className="section-number">4</div>
        <fieldset className="section-content personality-fieldset" aria-describedby={errors.personalityPreferences ? "personality-error" : undefined}>
          <legend id="personality-heading">Which personalities feel like a fit?</legend>
          <p className="section-help">Choose all that sound right. There’s no wrong combination.</p>
          <div className="personality-grid">
            {[
              ["affectionate", "Affectionate", "A devoted cuddle companion"],
              ["playful", "Playful", "Always ready for a little fun"],
              ["calm", "Calm", "Content with a quieter rhythm"],
              ["independent", "Independent", "Happy to have some space"],
            ].map(([value, label, description]) => (
              <label className="personality-card" key={value}>
                <input type="checkbox" name="personalityPreferences" value={value} />
                <span><strong>{label}</strong><small>{description}</small></span>
              </label>
            ))}
          </div>
          {errors.personalityPreferences && <p className="field-error" id="personality-error" tabIndex={-1}>{errors.personalityPreferences}</p>}
        </fieldset>
      </section>

      <div className="form-actions">
        <button className="button button-primary" type="submit">Show my matches <span aria-hidden="true">→</span></button>
        <p>We’ll use these answers only to shape your mock matches.</p>
      </div>
    </form>
  );
}
