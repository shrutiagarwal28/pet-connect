import Link from "next/link";

export default function HomePage() {
  return (
    <section className="hero page-shell">
      <div className="hero-copy">
        <p className="eyebrow">A more thoughtful way to adopt</p>
        <h1>Find a dog who fits your real life.</h1>
        <p className="hero-intro">
          Tell us a little about your home, routine, and hopes. We’ll introduce you
          to adoptable dogs who could feel right at home with you.
        </p>
        <Link className="button button-primary" href="/preferences">
          Find your dog <span aria-hidden="true">→</span>
        </Link>
        <p className="privacy-note">Takes about 2 minutes. No account needed.</p>
      </div>

      <div className="hero-art" aria-label="Illustration of a happy dog waiting to meet you">
        <div className="sun-shape" />
        <div className="dog-portrait" aria-hidden="true">🐕</div>
        <div className="hero-card hero-card-top">Personalized to your routine</div>
        <div className="hero-card hero-card-bottom">Made for happy beginnings</div>
      </div>
    </section>
  );
}

