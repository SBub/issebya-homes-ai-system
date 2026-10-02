import { format } from "date-fns";
import Image from "next/image";
import Link from "next/link";
import { fromCalendarDay } from "@/lib/date-utils";
import type { BlogPost } from "@/lib/blog/schema";

export function PostCard({ post }: { post: BlogPost }) {
  const { slug, title, description, date, hero, pinned } = post;
  const titleId = `post-${slug}-title`;

  return (
    <Link
      href={`/blog/${slug}`}
      aria-labelledby={titleId}
      className="group flex flex-row gap-4 md:gap-6 bg-shop-card text-foreground p-3.5"
    >
      {hero && (
        <div className="relative w-2/5 sm:w-1/3 aspect-square shrink-0 overflow-hidden">
          <Image
            src={hero.src}
            alt={hero.alt}
            fill
            className="object-cover"
            sizes="(min-width: 640px) 33vw, 40vw"
          />
        </div>
      )}

      <div className="flex flex-col justify-center min-w-0 text-xs">
        {pinned && <p className="uppercase tracking-[0.2em] text-[10px]">Pinned</p>}
        <p className="uppercase tracking-[0.2em] text-[10px]">
          {format(fromCalendarDay(date), "d MMM yyyy")}
        </p>
        <span
          id={titleId}
          className="font-medium text-sm my-[10px] group-hover:underline underline-offset-4"
        >
          {title}
        </span>
        <p className="leading-relaxed line-clamp-3">{description}</p>
      </div>
    </Link>
  );
}
