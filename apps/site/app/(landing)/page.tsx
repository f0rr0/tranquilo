"use client";

import type { ReactNode } from "react";
import release from "../../generated/release.json";

const installCommand = release.installCommand.replace(
  "curl -fsSL",
  "curl -sSL"
);

function Background() {
  return (
    <>
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-0 overflow-hidden"
      >
        <div className="landing-ambient absolute -inset-[18%]" />
      </div>
      <div aria-hidden="true" className="landing-noise fixed inset-0 z-[1]" />
    </>
  );
}

function MotifLines() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute top-[20%] right-[10%] z-[2] flex h-[100px] w-[100px] flex-col items-end opacity-20 max-md:top-10 max-md:right-6 max-md:h-auto max-md:w-16"
    >
      <span className="landing-motif-line w-full" />
      <span className="landing-motif-line w-4/5" />
      <span className="landing-motif-line w-3/5" />
      <span className="landing-motif-line w-[90%]" />
      <span className="landing-motif-line w-2/5" />
    </div>
  );
}

function SystemCoordinates() {
  return (
    <>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute top-[30%] left-8 z-[2] origin-top-left -rotate-90 text-[#2c1a0e]/20 text-[9px] tracking-[0.2em] max-md:hidden"
      >
        {"LAT.48.8566° N // LON.2.3522° E"}
      </div>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute right-8 bottom-[20%] z-[2] origin-bottom-right rotate-90 text-[#2c1a0e]/20 text-[9px] tracking-[0.2em] max-md:hidden"
      >
        {"SYS.OP.NORMAL // THREAD: MAIN"}
      </div>
    </>
  );
}

function Header() {
  return (
    <header className="col-span-full flex justify-between text-[9px] uppercase tracking-[0.15em] max-md:mb-14 max-md:flex-col max-md:items-start max-md:gap-3">
      <div className="flex gap-8 max-md:gap-6">
        <span>
          TRANQUILO{" "}
          <span className="text-[#2c1a0e]/50">v{release.version}</span>
        </span>
      </div>
      <nav aria-label="Main" className="flex gap-8 max-md:gap-6">
        <a
          className="text-[#a87966] no-underline transition-opacity hover:opacity-60"
          href="https://github.com/f0rr0/tranquilo"
        >
          GITHUB_REPO
        </a>
        <a
          className="text-[#a87966] no-underline transition-opacity hover:opacity-60"
          href={release.docsUrl}
        >
          DOCUMENTATION
        </a>
      </nav>
    </header>
  );
}

function Label({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <span className="mb-2 block text-[#a87966] text-[9px] uppercase tracking-[0.15em] max-md:mb-3">
      {children}
    </span>
  );
}

function InstallBlock() {
  return (
    <div className="relative w-full border-[#2c1a0e]/50 border-l pl-4 before:absolute before:top-0 before:left-[-3px] before:h-px before:w-[5px] before:bg-[#2c1a0e]">
      <Label>Install</Label>
      <button
        className="flex min-h-[45px] w-full items-center justify-between gap-4 rounded-[2px] border-0 bg-[#2c1a0e] px-4 py-3 text-left font-landing-mono text-[#f2ead8] max-md:min-h-[43px] max-md:px-3"
        onClick={() => {
          navigator.clipboard.writeText(installCommand).catch(() => undefined);
        }}
        type="button"
      >
        <code className="min-w-0 overflow-x-auto whitespace-nowrap text-[12px] [scrollbar-width:none] max-md:text-[11px] [&::-webkit-scrollbar]:hidden">
          {installCommand}
        </code>
        <span className="shrink-0 text-[9px] uppercase tracking-[0.1em] opacity-70">
          Copy ↗
        </span>
      </button>
    </div>
  );
}

function ProntoWordmark() {
  return (
    <a
      aria-label="Pronto"
      className="mx-0.5 inline-flex align-[-0.14em] text-[#00b564] no-underline transition-opacity hover:opacity-70"
      href="https://www.withpronto.com/"
      rel="noreferrer"
      target="_blank"
    >
      <span className="sr-only">Pronto</span>
      <svg
        aria-hidden="true"
        className="h-[1.05em] w-auto"
        fill="none"
        viewBox="0 0 99 28"
        xmlns="http://www.w3.org/2000/svg"
      >
        <text
          dominantBaseline="alphabetic"
          fill="currentColor"
          fontFamily="var(--font-pronto), sans-serif"
          fontSize="26"
          fontWeight="800"
          letterSpacing="-0.6"
          x="0"
          y="22"
        >
          Pronto
        </text>
      </svg>
    </a>
  );
}

function Hero() {
  return (
    <section className="col-[2/7] flex flex-col gap-12 self-center max-md:mb-20 max-md:w-full max-md:gap-10 max-lg:col-[1/7]">
      <div>
        <h1 className="mb-4 font-landing-script font-normal text-[76px] leading-[1.1] tracking-normal max-md:mb-6 max-md:text-[52px] max-md:leading-[1.05] max-lg:text-[68px]">
          Ask for house help.
          <br />
          Then relax.
        </h1>
        <p className="m-0 max-w-[80%] font-landing-sans text-[#2c1a0e] text-[14px] leading-[1.6] opacity-80 max-md:max-w-none max-md:pr-4">
          Tranquilo means calm. It helps your AI assistant find{" "}
          <ProntoWordmark /> house help slots, keep watching when nothing is
          open, and bring you back only when there is a real slot to book.
        </p>
      </div>
      <InstallBlock />
    </section>
  );
}

function LogEntry({
  children,
  label,
}: Readonly<{
  children: ReactNode;
  label: string;
}>) {
  return (
    <article>
      <div className="mb-4 flex justify-between border-[#2c1a0e]/20 border-b pb-1 max-md:mb-3 max-md:pb-1.5">
        <Label>{label}</Label>
      </div>
      <p className="m-0 font-landing-sans text-[12px] leading-[1.5] opacity-80">
        {children}
      </p>
    </article>
  );
}

function TerminalRow({
  children,
  prompt,
}: Readonly<{
  children?: ReactNode;
  prompt?: boolean;
}>) {
  return (
    <div className="mb-2 flex last:mb-0">
      <span className="w-5 shrink-0 text-[#2c1a0e]/50">
        {prompt ? ">" : undefined}
      </span>
      <span className="min-w-0 text-[#2c1a0e] [overflow-wrap:anywhere]">
        {children}
      </span>
    </div>
  );
}

function TerminalVisual() {
  return (
    <div className="mt-4 border border-[#2c1a0e]/20 bg-[#e3d2b9]/40 p-4 text-[9px] max-md:mt-5 max-md:p-3.5 max-md:leading-[1.6]">
      <TerminalRow prompt>
        <span className="text-[#2c1a0e]/50">
          tranquilo scan --target &quot;tomorrow eve&quot;
        </span>
      </TerminalRow>
      <TerminalRow>[SYS] Polling Pronto API...</TerminalRow>
      <TerminalRow>[SYS] State: No availability.</TerminalRow>
      <TerminalRow>[SYS] Entering passive watch mode...</TerminalRow>
      <TerminalRow prompt>
        <span className="landing-cursor inline-block h-2.5 w-1.5 bg-[#a87966] align-middle" />
      </TerminalRow>
    </div>
  );
}

function Logs() {
  return (
    <section className="col-[8/12] flex flex-col gap-16 self-center max-md:mb-20 max-md:w-full max-md:gap-14 max-lg:col-[7/13]">
      <LogEntry label="Ask">
        Tell Codex, Claude, or your terminal what you need in plain language.
        E.g., &quot;Find house help tomorrow evening.&quot;
      </LogEntry>
      <article>
        <div className="mb-4 flex justify-between border-[#2c1a0e]/20 border-b pb-1 max-md:mb-3 max-md:pb-1.5">
          <Label>Relax</Label>
        </div>
        <p className="m-0 font-landing-sans text-[12px] leading-[1.5] opacity-80">
          Tranquilo assumes background polling. If capacity is null, it
          maintains a passive scan protocol and issues interrupts only on state
          change (slot availability).
        </p>
        <TerminalVisual />
      </article>
      <LogEntry label="Book">
        Interrupt received. Return to context. Tranquilo facilitates booking via
        Pronto and localizes payment completion within the current terminal or
        AI assistant session.
      </LogEntry>
    </section>
  );
}

function Footer() {
  return (
    <footer className="col-span-full flex items-end justify-between border-[#2c1a0e]/20 border-t pt-4 max-md:mt-auto max-md:flex-col max-md:items-start max-md:gap-6 max-md:pt-6">
      <p className="m-0 max-w-[40%] font-landing-sans text-[#2c1a0e]/50 text-[11px] max-md:max-w-none max-md:leading-[1.5]">
        Tranquilo works with Pronto. It is not a replacement app; it is a
        calmer, terminal-native methodology for finding and booking domestic
        assistance.
      </p>
      <div className="flex items-center gap-4">
        <span className="w-20 text-[#2c1a0e]/50 text-[9px] uppercase tracking-[0.05em] max-md:w-16">
          Author
        </span>
        <a
          className="text-[#a87966] no-underline transition-opacity hover:opacity-60"
          href="https://github.com/f0rr0"
        >
          SID_JAIN ↗
        </a>
      </div>
    </footer>
  );
}

export default function Page() {
  return (
    <>
      <Background />
      <SystemCoordinates />
      <MotifLines />
      <main className="relative z-10 grid min-h-screen grid-cols-12 grid-rows-[auto_1fr_auto] gap-8 p-8 max-md:flex max-md:min-h-dvh max-md:flex-col max-md:gap-0 max-md:p-6 max-md:pb-10">
        <Header />
        <Hero />
        <Logs />
        <Footer />
      </main>
    </>
  );
}
