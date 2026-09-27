import Link from "next/link";
import { tabClasses } from "./tab-styles";

interface TabLinkProps {
  href: string;
  tabId: string;
  onClick?: () => void;
  children: React.ReactNode;
  className?: string;
}

export function TabLink({ href, tabId, onClick, children, className = "" }: TabLinkProps) {
  return (
    <Link
      href={href}
      data-tab-id={tabId}
      onClick={onClick}
      className={`${tabClasses()} ${className}`}
    >
      {children}
    </Link>
  );
}
