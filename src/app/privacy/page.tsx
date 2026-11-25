import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Database, EyeOff, Lock, ShieldCheck, Sparkles, Trash2 } from "lucide-react";

export const metadata: Metadata = { title: "Privacy" };

const SECTIONS = [
  {
    icon: Database,
    title: "Your data belongs to you",
    body: "Everything you save lives in your own account, protected by database row-level security. No other user can ever see your records, and MeOS never shares them.",
  },
  {
    icon: Sparkles,
    title: "How AI is used",
    body: "When you submit text, only that text is sent to the AI provider — server-side, never from your browser — to turn it into structured suggestions. You review and approve everything before it is saved. When you ask questions, your saved records (excluding document numbers) are used to compose the answer.",
  },
  {
    icon: EyeOff,
    title: "Sensitive details stay masked",
    body: "Document numbers are hidden by default in the interface and are never sent to the AI provider. MeOS gives no medical, legal, or financial advice — allergy and health notes are your own records only.",
  },
  {
    icon: Lock,
    title: "No passwords here — on purpose",
    body: "MeOS deliberately does not store passwords. Real secrets need dedicated end-to-end encryption, which is what the upcoming Secure Vault is for. Until then, keep passwords in a dedicated password manager.",
  },
  {
    icon: Trash2,
    title: "Leave any time",
    body: "Settings lets you export everything as JSON, delete all your data, or delete your entire account. Deletion is immediate and permanent.",
  },
] as const;

export default function PrivacyPage() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col gap-8 px-6 py-10">
      <Link
        href="/"
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
      >
        <ArrowLeft className="size-4" aria-hidden /> Back to MeOS
      </Link>

      <header className="flex flex-col gap-2">
        <span className="flex size-12 items-center justify-center rounded-2xl bg-success/10 text-success">
          <ShieldCheck className="size-6" aria-hidden />
        </span>
        <h1 className="text-3xl font-semibold tracking-tight">Privacy at MeOS</h1>
        <p className="text-muted-foreground">
          MeOS is a private memory system. Here is exactly how your information is handled.
        </p>
      </header>

      <div className="flex flex-col gap-6">
        {SECTIONS.map(({ icon: Icon, title, body }) => (
          <section key={title} className="flex gap-4">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-secondary text-foreground">
              <Icon className="size-4.5" aria-hidden />
            </span>
            <div>
              <h2 className="font-medium">{title}</h2>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{body}</p>
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}
