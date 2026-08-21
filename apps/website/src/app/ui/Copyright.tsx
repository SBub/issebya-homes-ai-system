export default async function Copyright() {
  "use cache";

  const currentYear = new Date().getFullYear();
  return (
    <div className="text-center text-black">
      &copy; {currentYear} issebya.homes. All rights reserved.
    </div>
  );
}
