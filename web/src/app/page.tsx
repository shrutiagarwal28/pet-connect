import Image from "next/image";
import Link from "next/link";

type ConfidenceIconKind = "heart" | "home" | "search";
type StepIconKind = "profile" | "matches" | "friend";

const confidenceItems: readonly { icon: ConfidenceIconKind; label: string }[] = [
  { icon: "heart", label: "Personalized matches" },
  { icon: "home", label: "Your household comes first" },
  { icon: "search", label: "No endless searching" },
];

const steps: readonly {
  number: number;
  icon: StepIconKind;
  title: string;
  description: string;
}[] = [
  {
    number: 1,
    icon: "profile",
    title: "Tell us about you",
    description: "Share a little about your home, lifestyle, and what you’re looking for in a dog.",
  },
  {
    number: 2,
    icon: "matches",
    title: "Meet your matches",
    description: "We’ll introduce you to dogs who fit your life and needs.",
  },
  {
    number: 3,
    icon: "friend",
    title: "Find your new best friend",
    description: "Connect, meet, and start building a bond that lasts.",
  },
];

function ConfidenceIcon({ kind }: { kind: ConfidenceIconKind }) {
  if (kind === "heart") {
    return <path d="M12 20.2 4.7 13A4.8 4.8 0 0 1 11.5 6l.5.6.5-.6a4.8 4.8 0 0 1 6.8 6.8Z" />;
  }

  if (kind === "home") {
    return (
      <>
        <path d="m4 11 8-7 8 7" />
        <path d="M6.5 9.5V20h11V9.5M10 20v-6h4v6" />
      </>
    );
  }

  return (
    <>
      <circle cx="10.5" cy="10.5" r="5.7" />
      <path d="m15 15 4.5 4.5" />
    </>
  );
}

function StepIcon({ kind }: { kind: StepIconKind }) {
  if (kind === "profile") {
    return (
      <svg viewBox="0 0 92 82" aria-hidden="true">
        <rect x="22" y="11" width="48" height="60" rx="4" />
        <path d="M37 11V7h18v4M31 31l4 4 7-8M31 48l4 4 7-8M49 31h12M49 48h12" />
      </svg>
    );
  }

  if (kind === "matches") {
    return (
      <svg viewBox="0 0 100 82" aria-hidden="true">
        <rect x="35" y="8" width="47" height="59" rx="5" transform="rotate(10 35 8)" />
        <rect x="15" y="18" width="50" height="56" rx="5" transform="rotate(-8 15 18)" />
        <circle cx="40" cy="41" r="8" />
        <path d="M26 61c3-8 9-12 16-12s13 4 16 12M65 27l4 4 8-9" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 96 82" aria-hidden="true">
      <circle cx="48" cy="41" r="30" />
      <path d="M48 59 33 44c-12-12 5-27 15-15 10-12 27 3 15 15Z" />
    </svg>
  );
}

export default function HomePage() {
  return (
    <>
      <section className="home-hero">
        <div className="hero page-shell">
          <div className="hero-copy">
            <p className="eyebrow">A more thoughtful way to adopt</p>
            <h1>Find your best friend.</h1>
            <p className="hero-intro">
              Tell us about your home, routine, and hopes. We’ll introduce you to
              adoptable dogs who could feel right at home with you.
            </p>
            <Link className="button button-primary hero-cta" href="/preferences">
              Find your dog
            </Link>
            <p className="privacy-note">
              <span className="clock-icon" aria-hidden="true" />
              Takes about 2 minutes. No account needed.
            </p>
          </div>

          <div className="hero-art">
            <Image
              className="hero-dog-image"
              src="/pet-connect-hero-dog.png"
              alt="Happy dog ready to meet an adopter"
              width={1536}
              height={1024}
              priority
              sizes="(max-width: 768px) 100vw, 52vw"
            />
          </div>
        </div>
      </section>

      <section className="confidence-strip" id="why-pet-connect" aria-label="Why Pet Connect">
        <div className="confidence-row page-shell">
          {confidenceItems.map((item) => (
            <div className="confidence-item" key={item.label}>
              <span className="confidence-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24"><ConfidenceIcon kind={item.icon} /></svg>
              </span>
              <span>{item.label}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="steps-section" id="how-it-works">
        <div className="page-shell steps-shell">
          <p className="eyebrow steps-eyebrow">Simple, personal, hopeful</p>
          <h2>A thoughtful match, from the start.</h2>
          <div className="steps-grid">
            {steps.map((step) => (
              <article className="step-card" key={step.number}>
                <span className="step-number">{step.number}</span>
                <div className="step-icon"><StepIcon kind={step.icon} /></div>
                <div>
                  <h3>{step.title}</h3>
                  <p>{step.description}</p>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="about-section" id="about">
        <div className="page-shell about-shell">
          <p className="eyebrow">Made for better beginnings</p>
          <h2>Less scrolling. More meaningful introductions.</h2>
          <p>Pet Connect starts with your everyday life, then helps the right dogs stand out.</p>
        </div>
      </section>
    </>
  );
}
