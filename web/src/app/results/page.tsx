"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import type { AdopterPreferences } from "@/lib/adopter-preferences";
import { MOCK_DOG_MATCHES } from "@/lib/mock-dogs";
import { loadPreferences } from "@/lib/preferences-session";

const titleCase = (value: string): string =>
  value.split("-").map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`).join(" ");

export default function ResultsPage() {
  const [preferences, setPreferences] = useState<AdopterPreferences | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const storageRead = window.setTimeout(() => {
      setPreferences(loadPreferences());
      setIsLoading(false);
    }, 0);

    return () => window.clearTimeout(storageRead);
  }, []);

  if (isLoading) {
    return <div className="page-shell loading-state" role="status">Gathering your matches…</div>;
  }

  if (!preferences) {
    return (
      <section className="page-shell empty-state">
        <span className="empty-icon" aria-hidden="true">🐾</span>
        <h1>Let’s learn what you’re looking for first.</h1>
        <p>Your answers aren’t available in this browser session.</p>
        <Link className="button button-primary" href="/preferences">Tell us your preferences</Link>
      </section>
    );
  }

  return (
    <div className="page-shell results-shell">
      <section className="results-heading">
        <div>
          <p className="eyebrow">Your first introductions</p>
          <h1>We found a few promising pals.</h1>
          <p>These dogs are mocked for now, but the experience is ready for a real matcher later.</p>
        </div>
        <Link className="button button-secondary" href="/preferences">Edit preferences</Link>
      </section>

      <aside className="preference-summary" aria-labelledby="summary-heading">
        <h2 id="summary-heading">What we kept in mind</h2>
        <div className="summary-chips">
          <span>Within {preferences.maxTravelDistanceMiles} miles of {preferences.zipCode}</span>
          <span>Up to {titleCase(preferences.maxDogSize)}</span>
          <span>{titleCase(preferences.activityLevel)} lifestyle</span>
          <span>{preferences.hoursAwayPerDay} {preferences.hoursAwayPerDay === 1 ? "hour" : "hours"} away daily</span>
          <span>{preferences.hasChildren ? `Children, youngest age ${preferences.youngestChildAge}` : "No children at home"}</span>
          <span>{preferences.hasExistingDogs ? "Lives with dogs" : "No resident dogs"}</span>
          <span>{preferences.hasExistingCats ? "Lives with cats" : "No resident cats"}</span>
          <span>{preferences.personalityPreferences.map(titleCase).join(" · ")}</span>
        </div>
      </aside>

      <section className="dog-grid" aria-label="Mock dog matches">
        {MOCK_DOG_MATCHES.map((dog, index) => (
          <article className="dog-card" key={dog.id}>
            <div className={`dog-image ${dog.colorClass}`}>
              <span className="match-badge">#{index + 1} match</span>
              <span className="dog-emoji" aria-hidden="true">{dog.emoji}</span>
            </div>
            <div className="dog-card-content">
              <div className="dog-title-row"><h2>{dog.name}</h2><span>{dog.distanceMiles} mi</span></div>
              <p className="dog-details">{dog.age} · {dog.size} · {dog.breedGroup}</p>
              <p className="dog-note">{dog.matchNote}</p>
              <div className="trait-row">{dog.traits.map((trait) => <span key={trait}>{titleCase(trait)}</span>)}</div>
              <button className="text-button" type="button" onClick={() => window.alert(`${dog.name}’s full profile will be part of the next slice.`)}>
                Meet {dog.name} <span aria-hidden="true">→</span>
              </button>
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}
