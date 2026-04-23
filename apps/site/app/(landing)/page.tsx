"use client";

import Link from "next/link";
import { type ReactNode, useEffect, useRef, useState } from "react";
import release from "../../generated/release.json";

const installCommand = release.installCommand.replace(
  "curl -fsSL",
  "curl -sSL"
);
const docsPath = `/docs/versions/v${release.version}`;

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
    <header className="col-span-full flex min-w-0 justify-between text-[9px] uppercase tracking-[0.15em] max-md:mb-14 max-md:flex-col max-md:items-start max-md:gap-3">
      <div className="flex gap-8 max-md:gap-6">
        <span>
          TRANQUILO{" "}
          <span className="text-[#2c1a0e]/50">v{release.version}</span>
        </span>
      </div>
      <nav aria-label="Main" className="flex min-w-0 gap-6 max-md:gap-5">
        <Link
          className="text-[#2c1a0e] no-underline transition-opacity hover:opacity-60"
          href={docsPath}
        >
          DOCUMENTATION
        </Link>
        <a
          className="text-[#2c1a0e] no-underline transition-opacity hover:opacity-60"
          href="https://github.com/f0rr0/tranquilo"
          rel="noreferrer"
          target="_blank"
        >
          GITHUB
        </a>
      </nav>
    </header>
  );
}

function Label({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <span className="mb-2 block text-[#2c1a0e] text-[9px] uppercase tracking-[0.15em] max-md:mb-3">
      {children}
    </span>
  );
}

function GitHubIcon({ className }: Readonly<{ className?: string }>) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="currentColor"
      viewBox="0 0 24 24"
    >
      <path d="M12 2C6.48 2 2 6.59 2 12.25c0 4.53 2.87 8.37 6.84 9.73.5.09.68-.22.68-.49v-1.9c-2.78.62-3.37-1.22-3.37-1.22-.45-1.18-1.11-1.49-1.11-1.49-.91-.64.07-.63.07-.63 1 .07 1.53 1.06 1.53 1.06.89 1.56 2.34 1.11 2.91.85.09-.66.35-1.11.63-1.36-2.22-.26-4.55-1.14-4.55-5.06 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.3.1-2.71 0 0 .84-.28 2.75 1.05A9.32 9.32 0 0 1 12 6.99c.85 0 1.7.12 2.5.34 1.9-1.33 2.74-1.05 2.74-1.05.55 1.41.2 2.45.1 2.71.64.72 1.03 1.63 1.03 2.75 0 3.93-2.34 4.79-4.56 5.05.36.32.68.94.68 1.9v2.8c0 .27.18.59.69.49A10.19 10.19 0 0 0 22 12.25C22 6.59 17.52 2 12 2Z" />
    </svg>
  );
}

function XIcon({ className }: Readonly<{ className?: string }>) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="currentColor"
      viewBox="0 0 24 24"
    >
      <path d="M18.2 2.75h3.07l-6.7 7.66 7.88 10.84h-6.17l-4.83-6.57-5.53 6.57H2.84l7.17-8.51L2.45 2.75h6.33l4.37 5.99 5.05-5.99Zm-1.08 16.59h1.7L7.85 4.56H6.02l11.1 14.78Z" />
    </svg>
  );
}

function HeartIcon({ className }: Readonly<{ className?: string }>) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="currentColor"
      viewBox="0 0 24 24"
    >
      <path d="M12 20.5c-.28 0-.56-.09-.8-.28-3.08-2.43-5.42-4.61-7.02-6.54C2.73 11.93 2 10.21 2 8.52 2 5.77 4.16 3.7 6.9 3.7c1.57 0 3.12.74 4.1 1.91.98-1.17 2.53-1.91 4.1-1.91 2.74 0 4.9 2.07 4.9 4.82 0 1.69-.73 3.41-2.18 5.16-1.6 1.93-3.94 4.11-7.02 6.54-.24.19-.52.28-.8.28Z" />
    </svg>
  );
}

function ClipboardIcon({ className }: Readonly<{ className?: string }>) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      viewBox="0 0 24 24"
    >
      <path
        d="M9 5.75A2.75 2.75 0 0 1 11.75 3h.5A2.75 2.75 0 0 1 15 5.75M9 5.75h6M9 5.75H7.75A2.75 2.75 0 0 0 5 8.5v9.75A2.75 2.75 0 0 0 7.75 21h8.5A2.75 2.75 0 0 0 19 18.25V8.5a2.75 2.75 0 0 0-2.75-2.75H15M9.75 11h4.5M9.75 15h4.5"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}

function CheckIcon({ className }: Readonly<{ className?: string }>) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      viewBox="0 0 24 24"
    >
      <path
        d="m5 12.5 4.25 4.25L19 7"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
    </svg>
  );
}

function TintedIcon({
  children,
  href,
  label,
}: Readonly<{
  children: ReactNode;
  href?: string;
  label?: string;
}>) {
  const className =
    "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#2c1a0e]/8 text-[#2c1a0e] ring-1 ring-[#2c1a0e]/10 transition-colors hover:bg-[#2c1a0e]/14";

  if (!href) {
    return <span className={className}>{children}</span>;
  }

  return (
    <a
      aria-label={label}
      className={className}
      href={href}
      rel="noreferrer"
      target="_blank"
    >
      {children}
    </a>
  );
}

function InstallBlock() {
  const [copied, setCopied] = useState(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined
  );

  useEffect(
    () => () => {
      if (resetTimer.current) {
        clearTimeout(resetTimer.current);
      }
    },
    []
  );

  const copyInstallCommand = () => {
    setCopied(true);
    if (resetTimer.current) {
      clearTimeout(resetTimer.current);
    }
    resetTimer.current = setTimeout(() => {
      setCopied(false);
    }, 1600);

    navigator.clipboard.writeText(installCommand).catch(() => undefined);
  };

  return (
    <div className="relative box-border w-[92%] min-w-0 max-w-[560px] border-[#2c1a0e]/50 border-l pl-4 before:absolute before:top-0 before:left-[-3px] before:h-px before:w-[5px] before:bg-[#2c1a0e] max-md:w-full max-md:max-w-full">
      <Label>Install</Label>
      <button
        aria-label={copied ? "Install command copied" : "Copy install command"}
        className="box-border flex min-h-[45px] w-full min-w-0 max-w-full cursor-pointer items-center justify-between gap-3 rounded-[2px] border-0 bg-[#2c1a0e] px-4 py-3 text-left font-landing-mono text-[#f2ead8] transition-opacity duration-200 hover:opacity-90 max-md:min-h-[43px] max-md:px-3"
        onClick={copyInstallCommand}
        type="button"
      >
        <code className="block min-w-0 flex-1 overflow-x-auto whitespace-nowrap text-[12px] [scrollbar-width:none] max-md:text-[11px] [&::-webkit-scrollbar]:hidden">
          {installCommand}
        </code>
        <span
          aria-live="polite"
          className={`inline-flex w-4 shrink-0 items-center justify-center text-[9px] uppercase tracking-[0.1em] transition-all duration-200 ${
            copied ? "scale-[1.03] opacity-100" : "scale-100 opacity-70"
          }`}
        >
          {copied ? (
            <>
              <CheckIcon className="h-3.5 w-3.5" />
              <span className="sr-only">Copied</span>
            </>
          ) : (
            <>
              <ClipboardIcon className="h-3.5 w-3.5" />
              <span className="sr-only">Copy</span>
            </>
          )}
        </span>
      </button>
    </div>
  );
}

function ProntoWordmark() {
  return (
    <a
      aria-label="Pronto"
      className="ml-[0.03em] inline align-baseline font-extrabold font-landing-pronto text-[#00b564] tracking-[-0.025em] no-underline transition-opacity hover:opacity-70"
      href="https://www.withpronto.com/"
      rel="noreferrer"
      target="_blank"
    >
      Pronto
    </a>
  );
}

function Hero() {
  return (
    <section className="col-[2/6] flex min-w-0 max-w-full flex-col gap-12 self-center max-md:mb-20 max-md:w-full max-md:gap-10 max-lg:col-[1/6]">
      <div>
        <h1 className="mb-4 font-landing-script font-normal text-[76px] leading-[1.1] tracking-normal max-md:mb-6 max-md:text-[52px] max-md:leading-[1.05] max-lg:text-[68px]">
          Ask for house help.
          <br />
          Then relax.
        </h1>
        <p className="m-0 max-w-[80%] font-landing-sans text-[#2c1a0e] text-[14px] leading-[1.6] opacity-80 max-md:max-w-none max-md:pr-4">
          Ask Codex or Claude for <ProntoWordmark /> house help in plain words.
          If the right slot is gone, Tranquilo keeps watching quietly, brings
          you back when one opens, and lets you finish booking and payment in
          the same AI session.
        </p>
      </div>
      <InstallBlock />
    </section>
  );
}

function DemoVideo() {
  return (
    <figure className="relative mt-6 min-w-0 max-md:mt-5">
      <div aria-hidden="true" className="landing-demo-aura" />
      <div className="landing-demo-shell">
        <div className="overflow-hidden rounded-[24px] bg-[#120f0d]">
          <video
            aria-label="Tranquilo product demo"
            autoPlay
            className="landing-demo-video"
            controls
            loop
            muted
            playsInline
            poster="/demo-poster.jpg"
            preload="metadata"
          >
            <source src="/demo.mp4" type="video/mp4" />
            Your browser does not support the video tag.
          </video>
        </div>
      </div>
    </figure>
  );
}

function Logs() {
  return (
    <section className="col-[7/12] flex min-w-0 max-w-full flex-col self-center max-md:mb-20 max-md:w-full max-lg:col-[6/13]">
      <article className="w-full">
        <div className="mb-4 flex justify-between border-[#2c1a0e]/20 border-b pb-1 max-md:mb-3 max-md:pb-1.5">
          <Label>Ask, Relax, Book</Label>
        </div>
        <DemoVideo />
      </article>
    </section>
  );
}

function Footer() {
  return (
    <footer className="col-span-full flex min-w-0 items-end justify-between border-[#2c1a0e]/20 border-t pt-4 max-md:mt-auto max-md:flex-col max-md:items-start max-md:gap-6 max-md:pt-6">
      <div className="ml-auto flex items-center gap-2.5 font-landing-sans text-[#2c1a0e] text-[11px] max-md:ml-0">
        <span className="inline-flex items-center gap-1.5">
          <span>Made with</span>
          <HeartIcon className="h-3.5 w-3.5 text-[#2c1a0e]/80" />
          <span>by Sid Jain</span>
        </span>
        <TintedIcon href="https://github.com/f0rr0" label="GitHub f0rr0">
          <GitHubIcon className="h-3.5 w-3.5" />
        </TintedIcon>
        <TintedIcon href="https://x.com/f0rr0" label="X f0rr0">
          <XIcon className="h-3.5 w-3.5" />
        </TintedIcon>
      </div>
    </footer>
  );
}

export default function Page() {
  return (
    <>
      <Background />
      <SystemCoordinates />
      <main className="relative z-10 box-border grid min-h-screen w-full min-w-0 max-w-full grid-cols-12 grid-rows-[auto_1fr_auto] gap-8 overflow-hidden p-8 max-md:mx-6 max-md:flex max-md:min-h-dvh max-md:w-[calc(100vw-48px)] max-md:flex-col max-md:gap-0 max-md:p-0 max-md:pt-6 max-md:pb-10">
        <Header />
        <Hero />
        <Logs />
        <Footer />
      </main>
    </>
  );
}
