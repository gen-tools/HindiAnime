"use client";

import { useState } from "react";
import { Mail, CheckCircle2 } from "lucide-react";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";

export default function ContactPage() {
  const [submitted, setSubmitted] = useState(false);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    // TODO: wire up to a real backend/email service during API integration phase.
    setSubmitted(true);
  }

  return (
    <div className="container-page max-w-xl py-14">
      <span className="eyebrow text-sm text-green-light">GET IN TOUCH</span>
      <h1 className="font-display mt-2 text-3xl font-extrabold text-text-primary">Contact Us</h1>
      <p className="mt-2 text-sm text-text-muted">
        Questions, feedback, or partnership inquiries — send us a message.
      </p>

      {submitted ? (
        <div className="mt-8 flex flex-col items-center gap-3 rounded-xl border border-green-primary/40 bg-green-primary/10 p-10 text-center">
          <CheckCircle2 className="h-8 w-8 text-green-light" />
          <p className="font-display text-lg font-bold text-text-primary">Message received</p>
          <p className="max-w-sm text-sm text-text-muted">
            This is a frontend-only demo, so nothing was actually sent — but that&rsquo;s exactly how the
            confirmation state will look once contact form submission is wired up.
          </p>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="mt-8 flex flex-col gap-4">
          <div>
            <label htmlFor="name" className="mb-1.5 block text-sm font-medium text-text-secondary">
              Name
            </label>
            <Input id="name" name="name" required placeholder="Your name" />
          </div>
          <div>
            <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-text-secondary">
              Email
            </label>
            <Input id="email" name="email" type="email" required placeholder="you@example.com" />
          </div>
          <div>
            <label htmlFor="subject" className="mb-1.5 block text-sm font-medium text-text-secondary">
              Subject
            </label>
            <Input id="subject" name="subject" required placeholder="What's this about?" />
          </div>
          <div>
            <label htmlFor="message" className="mb-1.5 block text-sm font-medium text-text-secondary">
              Message
            </label>
            <textarea
              id="message"
              name="message"
              required
              rows={5}
              placeholder="Write your message..."
              className="focus-ring w-full rounded-lg border border-border-line bg-surface px-4 py-2.5 text-sm text-text-primary placeholder:text-text-muted transition-colors focus:border-green-bright/70"
            />
          </div>
          <Button type="submit" size="lg" icon={<Mail className="h-4 w-4" />} className="mt-2 w-fit">
            Send Message
          </Button>
        </form>
      )}
    </div>
  );
}
