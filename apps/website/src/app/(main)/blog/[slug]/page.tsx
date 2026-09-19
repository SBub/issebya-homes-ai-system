import { format } from "date-fns";
import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";
import { fromCalendarDay } from "@/lib/date-utils";
import { allPosts, getPostBySlug } from "@/lib/blog/posts";
import { SITE_URL } from "@/lib/site";

export function generateStaticParams() {
  return allPosts.map(({ slug }) => ({ slug }));
}

export async function generateMetadata(props: PageProps<"/blog/[slug]">): Promise<Metadata> {
  const { slug } = await props.params;
  const post = getPostBySlug(slug);

  // An unknown slug is a 404, not a build failure: the page itself calls
  // notFound(). Returning a plain title here keeps generateMetadata from
  // throwing first.
  if (!post) return { title: "Post not found - issebya.homes" };

  const url = `${SITE_URL}/blog/${post.slug}`;

  return {
    title: `${post.title} - issebya.homes`,
    description: post.description,
    alternates: { canonical: url },
    openGraph: {
      title: post.title,
      description: post.description,
      url,
      type: "article",
      publishedTime: post.date,
      ...(post.hero ? { images: [{ url: post.hero.src, alt: post.hero.alt }] } : {}),
    },
  };
}

// No `export const dynamic`, no searchParams, cookies() or headers() read
// anywhere in this route or its imports, so it prerenders. `dynamicParams` is
// left unset on purpose: notFound() already handles an unknown slug, and that
// keeps this route free of dynamic config flags under `cacheComponents`.
export default async function BlogPostPage(props: PageProps<"/blog/[slug]">) {
  const { slug } = await props.params;
  const post = getPostBySlug(slug);

  if (!post) notFound();

  const { title, date, hero, Content } = post;

  return (
    <article className="max-w-2xl mx-auto px-6 md:px-12 py-8">
      <h1 className="text-4xl font-hand font-bold">{title}</h1>
      <p className="text-xs text-gray-600 mt-1 mb-6">
        {format(fromCalendarDay(date), "d MMMM yyyy")}
      </p>

      {hero && (
        <Image
          src={hero.src}
          alt={hero.alt}
          width={hero.width}
          height={hero.height}
          sizes="(max-width: 768px) 100vw, 672px"
          className="w-full h-auto mb-8"
        />
      )}

      <Content />
    </article>
  );
}
