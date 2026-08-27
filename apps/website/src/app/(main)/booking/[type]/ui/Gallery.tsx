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

  const touchStartX = useRef<number | null>(null);

  const handleThumbnailClick = (index: number) => {
    setImageIndex(index);
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
      } else if (diff < 0 && imageIndex > 0) {
        setImageIndex(imageIndex - 1);
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
        className="relative w-full aspect-[4/3] bg-[#f5f0e8]"
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        <Image
          src={images[imageIndex].src}
          alt={images[imageIndex].label}
          fill
          className="object-contain"
        />
      </div>
      <div className="text-center font-hand text-lg break-words my-2 md:my-4 px-4">
        {images[imageIndex].label}
      </div>

      <div className="flex flex-wrap gap-1.5 md:gap-2 lg:gap-3 lg:px-6 justify-center">
        {images.map((image, index) => (
          <button
            key={index}
            onClick={() => handleThumbnailClick(index)}
            className={`relative w-12 h-12 md:w-16 md:h-16 lg:w-16 lg:h-16 flex-shrink-0 cursor-pointer transition-opacity ${
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
