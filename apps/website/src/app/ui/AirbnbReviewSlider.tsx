"use client";

import { useEffect, useRef, useState } from "react";

type Review = {
  name: string;
  date: string;
  text: string;
};

type Props = {
  reviews: Review[];
  collapsedLines?: number;
};

export function AirbnbReviewSlider({ reviews, collapsedLines = 3 }: Props) {
  const [index, setIndex] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [isClamped, setIsClamped] = useState(false);
  const textRef = useRef<HTMLParagraphElement>(null);
  const touchStartX = useRef<number | null>(null);

  useEffect(() => {
    const el = textRef.current;
    if (!el) return;
    // Compare scrollHeight (full content) vs clientHeight (visible/clamped)
    setIsClamped(el.scrollHeight > el.clientHeight);
  }, [index, expanded]);

  const prev = () => setIndex((i) => (i === 0 ? reviews.length - 1 : i - 1));
  const next = () => setIndex((i) => (i === reviews.length - 1 ? 0 : i + 1));

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current === null) return;
    const diff = touchStartX.current - e.changedTouches[0].clientX;
    if (Math.abs(diff) > 50) {
      diff > 0 ? next() : prev();
    }
    touchStartX.current = null;
  };

  if (!reviews.length) return null;

  const review = reviews[index];

  return (
    <div className="max-w-md">
      <div
        className="border border-dashed border-gray-300 p-4 rounded-lg"
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        <div className="flex items-center gap-2 mb-1">
          <span className="text-yellow-500 text-sm">{"★".repeat(5)}</span>
          <span className="text-xs text-gray-500">Airbnb</span>
        </div>
        <p className="font-bold text-sm">{review.name}</p>
        <p className="text-xs text-gray-500 mb-2">{review.date}</p>
        <p
          ref={textRef}
          className="text-sm leading-relaxed transition-[max-height] duration-300 ease-in-out overflow-hidden"
          style={
            expanded
              ? {
                  maxHeight: "1000px",
                  minHeight: `${collapsedLines * 1.625}em`,
                }
              : {
                  display: "-webkit-box",
                  WebkitLineClamp: collapsedLines,
                  WebkitBoxOrient: "vertical" as const,
                  maxHeight: `${collapsedLines * 1.625}em`,
                  minHeight: `${collapsedLines * 1.625}em`,
                }
          }
        >
          {review.text}
        </p>
        <button
          onClick={() => setExpanded((e) => !e)}
          className={`text-xs underline mt-1 cursor-pointer ${
            isClamped || expanded ? "text-gray-500 hover:text-gray-700" : "invisible"
          }`}
        >
          {expanded ? "Show less" : "Read more"}
        </button>
      </div>

      {reviews.length > 1 && (
        <div className="flex items-center gap-3 mt-3">
          <button
            onClick={prev}
            className="text-gray-400 hover:text-gray-700 text-lg cursor-pointer"
            aria-label="Previous review"
          >
            &#8592;
          </button>
          <span className="text-xs text-gray-500">
            {index + 1} / {reviews.length}
          </span>
          <button
            onClick={next}
            className="text-gray-400 hover:text-gray-700 text-lg cursor-pointer"
            aria-label="Next review"
          >
            &#8594;
          </button>
        </div>
      )}
    </div>
  );
}
