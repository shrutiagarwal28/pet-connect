"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { PreferencesForm } from "@/components/preferences-form";
import type { AdopterPreferences } from "@/lib/adopter-preferences";
import { savePreferences } from "@/lib/preferences-session";

export default function PreferencesPage() {
  const router = useRouter();
  const [submissionError, setSubmissionError] = useState<string | null>(null);

  const handleValidPreferences = (preferences: AdopterPreferences) => {
    if (!savePreferences(preferences)) {
      setSubmissionError("We couldn’t save your answers in this browser. Please check your privacy settings and try again.");
      return;
    }

    setSubmissionError(null);
    router.push("/results");
  };

  return (
    <div className="page-shell narrow-shell">
      <Link className="back-link" href="/">← Back home</Link>
      <div className="page-heading">
        <p className="eyebrow">Your match profile</p>
        <h1>Let’s find your kind of dog.</h1>
        <p>A few practical details will help us make this first set of matches feel personal.</p>
      </div>
      <PreferencesForm onValidPreferences={handleValidPreferences} submissionError={submissionError} />
    </div>
  );
}

