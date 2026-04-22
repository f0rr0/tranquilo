import {
  DocsBody,
  DocsDescription,
  DocsPage,
  DocsTitle,
} from "fumadocs-ui/page";
import { notFound, redirect } from "next/navigation";
import { getMDXComponents } from "@/components/mdx";
import { latestDocsPath } from "@/lib/release";
import { source } from "@/lib/source";

interface PageProps {
  params: Promise<{
    slug?: string[];
  }>;
}

export function generateStaticParams() {
  return source.generateParams();
}

export async function generateMetadata({ params }: PageProps) {
  const { slug = [] } = await params;
  const page = source.getPage(slug);
  if (!page) {
    return {};
  }
  return {
    description: page.data.description,
    title: page.data.title,
  };
}

export default async function Page({ params }: PageProps) {
  const { slug = [] } = await params;
  if (slug.length === 0 || (slug.length === 1 && slug[0] === "latest")) {
    redirect(latestDocsPath());
  }

  const page = source.getPage(slug);
  if (!page) {
    notFound();
  }

  const MDX = page.data.body;

  return (
    <DocsPage toc={page.data.toc}>
      <DocsTitle>{page.data.title}</DocsTitle>
      <DocsDescription>{page.data.description}</DocsDescription>
      <DocsBody>
        <MDX components={getMDXComponents()} />
      </DocsBody>
    </DocsPage>
  );
}
