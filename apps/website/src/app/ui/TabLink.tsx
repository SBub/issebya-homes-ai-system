import Link from "next/link";
import { tabStateClasses } from "./tab-styles";

interface TabLinkProps {
  href: string;
  isActive: boolean;
  onClick?: () => void;
  children: React.ReactNode;
  className?: string;
}

export function TabLink({ href, isActive, onClick, children, className = "" }: TabLinkProps) {
  return (
    <Link href={href} onClick={onClick} className={`${tabStateClasses(isActive)} ${className}`}>
      {children}
    </Link>
  );
}
