import type { Metadata } from "next";
import { Sparkles, Globe2, Layers } from "lucide-react";

export const metadata: Metadata = {
  title: "About",
  description: "About HindiAnime — a concept anime streaming interface.",
};

const pillars = [
  {
    icon: Globe2,
    title: "Multi-language by design",
    body: "Every title on HindiAnime is built around language availability first — audio and subtitles across ten languages, shown clearly before you press play.",
  },
  {
    icon: Layers,
    title: "One consistent experience",
    body: "From browsing to the watch page, the interface follows the same dark, cinematic design system so nothing ever feels bolted on.",
  },
  {
    icon: Sparkles,
    title: "Built to grow",
    body: "This is currently a frontend concept running on mock data. It's structured so a real catalog and streaming layer can be connected later without reworking the UI.",
  },
];

export default function AboutPage() {
  return (
    <div className="container-page py-14">
      <span className="eyebrow text-sm text-green-light">ABOUT HINDIANIME</span>
      <h1 className="font-display mt-2 max-w-2xl text-3xl font-extrabold text-text-primary md:text-4xl">
        A concept for how anime streaming could feel.
      </h1>
      <p className="mt-4 max-w-2xl text-sm leading-relaxed text-text-secondary md:text-base">
        HindiAnime is a design and frontend concept for a multi-language anime streaming platform.
        This build focuses entirely on the interface — browsing, discovery, and a mock playback
        experience — using placeholder data rather than a live catalog or real video sources.
      </p>

      <div className="mt-12 grid gap-6 sm:grid-cols-3">
        {pillars.map((p) => (
          <div key={p.title} className="rounded-xl border border-border-line bg-surface p-6">
            <p.icon className="h-6 w-6 text-green-bright" />
            <h2 className="font-display mt-4 text-base font-bold text-text-primary">{p.title}</h2>
            <p className="mt-2 text-sm leading-relaxed text-text-muted">{p.body}</p>
          </div>
        ))}
      </div>

      <div className="mt-12 max-w-2xl rounded-xl border border-border-line bg-surface p-6 text-sm leading-relaxed text-text-muted">
        <p>
          HindiAnime does not host, distribute, or claim rights to any anime content. All titles,
          artwork, and episode data shown here are placeholders used for design purposes only.
        </p>
      </div>
    </div>
  );
}
