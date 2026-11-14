import Image from 'next/image';

export function BrandLogo() {
  return (
    <Image
      className="brand-logo"
      src="/brand/tuheng-logo.svg"
      alt="图衡几何图标"
      width={64}
      height={64}
      unoptimized
      loading="eager"
    />
  );
}
