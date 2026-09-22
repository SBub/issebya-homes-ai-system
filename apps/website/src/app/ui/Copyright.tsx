import { cacheLife } from "next/cache";

export default async function Copyright() {
  "use cache";
  cacheLife("max");

  const currentYear = new Date().getFullYear();
  return (
    <div className="text-center text-black">
      &copy; {currentYear} issebya.homes. All rights reserved.
    </div>
  );
}
