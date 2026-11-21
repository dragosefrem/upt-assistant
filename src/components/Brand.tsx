import Image from "next/image";
import Link from "next/link";

export function Brand() {
  return (
    <Link href="/" aria-label="Poli" className="brand">
      <Image src="/images/mascot.svg" alt="" width={36} height={36} />
      <span>Poli</span>
    </Link>
  );
}
