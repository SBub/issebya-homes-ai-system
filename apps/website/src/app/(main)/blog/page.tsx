import type { Metadata } from "next";
import { allPosts } from "@/lib/blog/posts";
import { PostCard } from "./ui/PostCard";

export const metadata: Metadata = {
  title: "Blog - issebya.homes",
  description: "Notes on Almoçageme, the Sintra-Cascais coast, and staying at issebya.homes.",
};

// Reads nothing from the request (no cookies(), no headers(), no
// searchParams), so this route stays part of the static shell.
export default function BlogIndexPage() {
  return (
    <section
      aria-label="Posts"
      className="bg-shop-ground px-4 py-10 md:px-12 md:py-16 min-h-screen"
    >
      {allPosts.length === 0 ? (
        <p className="text-secondary">No posts yet. Check back soon.</p>
      ) : (
        <ul className="flex flex-col gap-6 max-w-3xl mx-auto">
          {allPosts.map((post) => (
            <li key={post.slug}>
              <PostCard post={post} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
