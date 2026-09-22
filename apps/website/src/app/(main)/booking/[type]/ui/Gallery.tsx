"use client";

import Image from "next/image";
import { useRef, useState } from "react";

export type GalleryImage = {
  src: string;
  label: string;
};

type Props = {
  images: GalleryImage[];
};

export default function Gallery({ images }: Props) {
  const [imageIndex, setImageIndex] = useState(0);
  const [aspectRatio, setAspectRatio] = useState<number | null>(null);

  const touchStartX = useRef<number | null>(null);

  const handleThumbnailClick = (index: number) => {
    setImageIndex(index);
    setAspectRatio(null);
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current === null) return;

    const touchEndX = e.changedTouches[0].clientX;
    const diff = touchStartX.current - touchEndX;
    const swipeThreshold = 50;

    if (Math.abs(diff) > swipeThreshold) {
      if (diff > 0 && imageIndex < images.length - 1) {
        setImageIndex(imageIndex + 1);
        setAspectRatio(null);
      } else if (diff < 0 && imageIndex > 0) {
        setImageIndex(imageIndex - 1);
        setAspectRatio(null);
      }
    }

    touchStartX.current = null;
  };

  if (!images.length || imageIndex >= images.length) {
    return null;
  }

  return (
    <>
      <div
        className="relative w-[60%] mx-auto"
        style={{ aspectRatio: aspectRatio ?? 4 / 3 }}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        <Image
          src={images[imageIndex].src}
          alt={images[imageIndex].label}
          fill
          className="object-contain"
          onLoad={(e) => {
            const img = e.currentTarget;
            setAspectRatio(img.naturalWidth / img.naturalHeight);
          }}
        />
      </div>
      <div className="text-center break-words my-2 md:my-4 px-4 text-secondary">
        {images[imageIndex].label}
      </div>

      <div className="grid grid-cols-7 gap-1.5 md:gap-2 lg:gap-3 lg:px-6 justify-items-center">
        {images.map((image, index) => (
          <button
            key={index}
            onClick={() => handleThumbnailClick(index)}
            className={`relative w-[33.6px] h-[33.6px] md:w-[44.8px] md:h-[44.8px] lg:w-[44.8px] lg:h-[44.8px] flex-shrink-0 cursor-pointer transition-opacity ${
              index === imageIndex ? "opacity-100" : "opacity-40 hover:opacity-70"
            }`}
          >
            <Image src={image.src} alt={image.label} fill className="object-cover" />
          </button>
        ))}
      </div>
    </>
  );
}
