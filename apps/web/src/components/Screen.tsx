import type { ReactNode } from 'react';

interface ScreenProps {
  title: string;
  intro?: string;
  children?: ReactNode;
}

export function Screen({ title, intro, children }: ScreenProps) {
  return (
    <section className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 sm:py-12">
      <h1 className="text-3xl leading-tight font-bold tracking-tight sm:text-4xl">{title}</h1>
      {intro && <p className="mt-4 max-w-prose text-lg leading-relaxed text-ink-muted">{intro}</p>}
      {children}
    </section>
  );
}
