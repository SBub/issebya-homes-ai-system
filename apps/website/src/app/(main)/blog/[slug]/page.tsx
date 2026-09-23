import { format } from "date-fns";
import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";
import { fromCalendarDay } from "@/lib/date-utils";
import { Breadcrumb } from "@/app/ui/Breadcrumb";
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
    <article className="p-4 md:p-12">
      <Breadcrumb parent={{ href: "/blog", label: "blog" }} title={title} />

      <h1 className="text-price">{title}</h1>
      <p className="text-xs text-gray-600 mt-1 mb-6">
        {format(fromCalendarDay(date), "d MMMM yyyy")}
      </p>

      {hero && (
        <div className="page-decor-photo mb-8">
          <Image
            src={hero.src}
            alt={hero.alt}
            fill
            className="object-cover"
            sizes="(min-width: 640px) 320px, 100vw"
          />
        </div>
      )}

      <div className="max-w-[70ch]">
        <Content />
      </div>
    </article>
  );
}
