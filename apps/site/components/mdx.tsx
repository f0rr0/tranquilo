import { Callout } from "fumadocs-ui/components/callout";
import { Cards, Card as FumadocsCard } from "fumadocs-ui/components/card";
import { Step as FumadocsStep, Steps } from "fumadocs-ui/components/steps";
import { Tab, Tabs } from "fumadocs-ui/components/tabs";
import defaultMdxComponents from "fumadocs-ui/mdx";
import { icons } from "lucide-react";
import type { MDXComponents } from "mdx/types";
import type { ComponentProps, ReactNode } from "react";

type CardProps = ComponentProps<typeof FumadocsCard> & {
  icon?: ReactNode | string;
};

type StepProps = ComponentProps<typeof FumadocsStep> & {
  title?: string;
};

type CalloutProps = ComponentProps<typeof Callout>;

function iconFor(value: ReactNode | string | undefined): ReactNode {
  if (typeof value !== "string") {
    return value;
  }
  const normalized = value
    .split("-")
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join("");
  const Icon = icons[normalized as keyof typeof icons];
  return Icon ? <Icon className="size-4" /> : undefined;
}

function Card({ icon, ...props }: CardProps) {
  return <FumadocsCard icon={iconFor(icon)} {...props} />;
}

function Step({ children, title, ...props }: StepProps) {
  return (
    <FumadocsStep {...props}>
      {title ? <h3>{title}</h3> : null}
      {children}
    </FumadocsStep>
  );
}

function Note(props: CalloutProps) {
  return <Callout type="info" {...props} />;
}

function Tip(props: CalloutProps) {
  return <Callout type="info" {...props} />;
}

function Warning(props: CalloutProps) {
  return <Callout type="warn" {...props} />;
}

export function getMDXComponents(components?: MDXComponents): MDXComponents {
  return {
    ...defaultMdxComponents,
    Card,
    Cards,
    Note,
    Step,
    Steps,
    Tab,
    Tabs,
    Tip,
    Warning,
    ...components,
  } as unknown as MDXComponents;
}
