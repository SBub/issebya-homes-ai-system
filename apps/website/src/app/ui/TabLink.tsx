import Link from "next/link";

interface TabLinkProps {
  href: string;
  isActive: boolean;
  onClick?: () => void;
  children: React.ReactNode;
  className?: string;
}

export function TabLink({ href, isActive, onClick, children, className = "" }: TabLinkProps) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className={`${isActive ? "bg-[#d9b98b]" : "text-gray-600 hover:text-black"} ${className}`}
    >
      {children}
    </Link>
  );
}
