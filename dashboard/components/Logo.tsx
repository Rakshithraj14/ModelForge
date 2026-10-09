import Image from "next/image";
import mark from "./logo.png";

// The ModelForge mark: a face crop of the brand illustration (app/opengraph-image.jpg).
export function LogoMark({ size = 28, className = "" }: { size?: number; className?: string }) {
  return <Image src={mark} alt="" width={size} height={size} className={`rounded-[8px] ring-1 ring-line ${className}`} priority />;
}

export function Wordmark({ size = 28 }: { size?: number }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <LogoMark size={size} />
      <span className="font-display text-[19px] font-bold tracking-tight text-ink">ModelForge</span>
    </span>
  );
}
