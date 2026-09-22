import Image from "next/image";

export function InstagramLink() {
  return (
    <a
      href="https://www.instagram.com/issebya.homes"
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Instagram"
      className="mb-4"
    >
      <Image
        src="/instagram.webp"
        alt="Instagram"
        width={24}
        height={18}
        className="hover:opacity-70 transition-opacity"
      />
    </a>
  );
}
