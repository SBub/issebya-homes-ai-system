/**
 * The shop product registry: the single list `/shop`, `/shop/[slug]` and
 * `sitemap.ts` are all driven from.
 *
 * The list is explicit, not a scan of a directory or a database read, for the
 * same reason as the blog registry (`src/lib/blog/posts.ts`): IO in a module
 * both routes import is exactly what quietly drops a page out of the static
 * shell.
 *
 * Every entry is validated at module scope, so a malformed product throws
 * while this module is being evaluated and fails the build.
 *
 * Slugs are stable identifiers, not just URLs: `public.shop_wishlist_items`
 * stores them in `product_slug` (there is no numeric product id). Renaming a
 * slug orphans every wish recorded against it, so don't rename one casually.
 * If a rename is unavoidable, migrate those rows in the same PR.
 *
 * Order in this file does not matter for the grid: `/shop` sorts by
 * `createdAt` (then slug) on the server. Two entries deliberately share a day
 * so the slug tie-break stays exercised.
 *
 * Prices and dates are placeholders until the owner confirms them; the
 * photos, names and descriptions describe the real pieces.
 */
import { assertUniqueProductSlugs, type Product, toProduct } from "./schema";

const products: Product[] = [
  {
    slug: "scrolled-silver-dish",
    brand: "Vintage",
    name: "Scrolled silver dish",
    price: { amount: 8500, currency: "EUR" },
    description:
      "A long, shallow silver-plated dish with a spiral scroll at each end, like the prow of a small boat. For keys, letters or a few lemons.",
    details:
      "Silver-plated metal with a soft, worn patina and light surface marks that suit its age.\n\nAbout 42 cm end to end. Wipe with a dry cloth; not for the dishwasher.",
    images: [
      {
        src: "/shop/scrolled-silver-dish.webp",
        alt: "Shallow silver dish with spiral scroll handles on a white plinth",
        width: 736,
        height: 981,
      },
    ],
    createdAt: "2026-09-20",
  },
  {
    slug: "mussel-shell-lamp",
    brand: "Found",
    name: "Mussel shell lamp",
    price: { amount: 42000, currency: "EUR" },
    description:
      "A tall lamp shaped like a single mussel shell, its ridged surface glowing warm from the base. Sculpture by day, lantern by night.",
    details:
      "Moulded resin shell, about 90 cm tall, on a solid oak block base with a small brass plaque. Warm bulb included, E27 fitting.\n\nDust with a soft brush. Keep out of direct sun to protect the tint.",
    images: [
      {
        src: "/shop/mussel-shell-lamp.webp",
        alt: "Tall shell-shaped lamp glowing from the base, on a wooden block against oak panelling",
        width: 900,
        height: 1200,
      },
    ],
    createdAt: "2026-09-14",
  },
  {
    slug: "silver-trumpet-bud-vase",
    brand: "Vintage",
    name: "Silver trumpet bud vase",
    price: { amount: 6000, currency: "EUR" },
    description:
      "A slim silver vase with a fluted trumpet mouth, made for one or two stems. Shown here on a bathroom ledge with a pair of poppies.",
    details:
      "Silver-plated brass, weighted foot, about 18 cm tall. Holds water.\n\nPolish now and then with a silver cloth. The soap dish in the photo is not included.",
    images: [
      {
        src: "/shop/silver-trumpet-bud-vase.webp",
        alt: "Slim fluted silver vase holding two poppies on a pink marble ledge beside a soap dish",
        width: 736,
        height: 981,
      },
    ],
    createdAt: "2026-08-30",
  },
  {
    slug: "calvin-klein-tile-link-watch",
    brand: "Calvin Klein",
    name: "Tile-link bracelet watch",
    price: { amount: 18000, currency: "EUR" },
    description:
      "A Swiss-made Calvin Klein watch on a bracelet of loose polished steel tiles, with a small pale pink mother-of-pearl dial. Early 2000s.",
    details:
      "Stainless steel case and bracelet, quartz movement, mother-of-pearl dial. Light scratches on the tiles from wear.\n\nFits a wrist up to about 17 cm. New battery fitted.",
    images: [
      {
        src: "/shop/calvin-klein-tile-link-watch.webp",
        alt: "Steel tile-link Calvin Klein watch with a pink dial held in a hand",
        width: 961,
        height: 1200,
      },
    ],
    createdAt: "2026-08-30",
  },
  {
    slug: "stoneware-winged-horse",
    brand: "Atelier",
    name: "Stoneware winged horse",
    price: { amount: 9500, currency: "EUR" },
    description:
      "A small hand-built stoneware horse with wings, under a speckled white glaze. Every leg slightly different, the way a good one should be.",
    details:
      "Hand-built stoneware, speckled white glaze, about 12 cm tall and 15 cm long. Unglazed underside.\n\nOne of a kind. Keep away from the edge of shelves.",
    images: [
      {
        src: "/shop/stoneware-winged-horse.webp",
        alt: "Small white glazed ceramic horse with wings on a plain grey background",
        width: 1075,
        height: 1112,
      },
    ],
    createdAt: "2026-08-18",
  },
  {
    slug: "beaded-striped-kitten-heels",
    brand: "Vintage",
    name: "Beaded striped kitten heels",
    price: { amount: 14000, currency: "EUR" },
    description:
      "Pointed slingback mules in pale blue and cream striped silk, tied at the side with glass beads on cord. A low, easy kitten heel.",
    details:
      "Striped silk upper, leather lining and sole, glass bead ties. About 5 cm heel.\n\nEU 38. Gently worn; a little wear to the insole.",
    images: [
      {
        src: "/shop/beaded-striped-kitten-heels.webp",
        alt: "Pale blue and cream striped silk kitten heel mules with glass bead ties, held in a hand",
        width: 713,
        height: 1017,
      },
    ],
    createdAt: "2026-08-05",
  },
  {
    slug: "map-print-sail-tote",
    brand: "Atelier",
    name: "Map-print sail tote",
    price: { amount: 22000, currency: "EUR" },
    description:
      "A wide canvas tote cut like a folded sail, printed with a faded city plan and hung from a single black leather strap.",
    details:
      "Heavy cotton canvas with a printed map panel, leather shoulder strap, zip along both edges.\n\nAbout 60 cm across at the widest point. Spot clean.",
    images: [
      {
        src: "/shop/map-print-sail-tote.webp",
        alt: "Wide cream canvas tote with a faded map print and a black leather strap",
        width: 750,
        height: 750,
      },
    ],
    createdAt: "2026-07-27",
  },
  {
    slug: "hammered-brass-mobile",
    brand: "Atelier",
    name: "Hammered brass mobile",
    price: { amount: 36000, currency: "EUR" },
    description:
      "A hanging mobile of hammered brass and copper shapes on curved brass arms, with one red disc. It turns slowly in the least draught.",
    details:
      "Hand-hammered brass and copper, some pieces patinated or painted, hung on brass wire. About 120 cm tall and 90 cm wide when open.\n\nComes with a ceiling hook. Handle by the top arm only.",
    images: [
      {
        src: "/shop/hammered-brass-mobile.webp",
        alt: "Hanging mobile of hammered brass, copper and one red disc above a white bed",
        width: 900,
        height: 1200,
      },
    ],
    createdAt: "2026-07-12",
  },
  {
    slug: "antique-satin-ballet-slippers",
    brand: "Vintage",
    name: "Antique satin ballet slippers",
    price: { amount: 12000, currency: "EUR" },
    description:
      "A pair of old blue satin ballet slippers with silver bullion fringe, tulle and long ribbon ties, faded exactly as you would hope. For display.",
    details:
      "Silk satin, metal thread fringe, cotton tulle, ribbon ties. Late 19th or early 20th century, condition as seen.\n\nNot for wearing. Keep out of direct light.",
    images: [
      {
        src: "/shop/antique-satin-ballet-slippers.webp",
        alt: "Pair of faded blue satin ballet slippers with silver fringe and ribbon ties on linen",
        width: 719,
        height: 1046,
      },
    ],
    createdAt: "2026-06-29",
  },
  {
    slug: "silver-brocade-wrap-skirt",
    brand: "Atelier",
    name: "Silver brocade wrap skirt",
    price: { amount: 16000, currency: "EUR" },
    description:
      "A short wrap skirt in silver-grey brocade woven with clouds and flowers, closed with a long narrow tie. Catches every bit of light.",
    details:
      "Silk blend brocade, cotton lining, wrap closure with a self-fabric tie.\n\nOne size fits about EU 36 to 40 thanks to the wrap. Dry clean.",
    images: [
      {
        src: "/shop/silver-brocade-wrap-skirt.webp",
        alt: "Silver-grey brocade wrap mini skirt with cloud and flower motifs laid on grey fabric",
        width: 969,
        height: 1200,
      },
    ],
    createdAt: "2026-06-15",
  },
  {
    slug: "silver-anemone-earring",
    brand: "Atelier",
    name: "Silver anemone earring",
    price: { amount: 7500, currency: "EUR" },
    description:
      "A single silver earring shaped like a sea anemone, dozens of fine tendrils tipped with tiny beads, hung below a small pearl stud.",
    details:
      "Sterling silver, freshwater pearl, about 4 cm across. Sold as a single earring.\n\nStore flat in its box; the tendrils bend if crushed.",
    images: [
      {
        src: "/shop/silver-anemone-earring.webp",
        alt: "Silver sea anemone shaped earring with a pearl, worn on an ear",
        width: 942,
        height: 1200,
      },
    ],
    createdAt: "2026-05-31",
  },
  {
    slug: "fishnet-face-veil",
    brand: "Atelier",
    name: "Fishnet face veil",
    price: { amount: 4500, currency: "EUR" },
    description:
      "A fine black net veil that sits close over the face and hair, tied at the nape. Old-fashioned in the best way.",
    details: "Nylon net, elastic edge, about 40 cm deep. One size.\n\nHand wash cold, dry flat.",
    images: [
      {
        src: "/shop/fishnet-face-veil.webp",
        alt: "Fine black fishnet veil worn over a face with dark hair, against cream tiles",
        width: 900,
        height: 1200,
      },
    ],
    createdAt: "2026-05-16",
  },
  {
    slug: "sun-and-moon-iron-chairs",
    brand: "Vintage",
    name: "Sun and moon iron chairs",
    price: { amount: 68000, currency: "EUR" },
    description:
      "A pair of slim wrought iron chairs, one with a crescent moon in the back and one with a sun, each with a round linen cushion.",
    details:
      "Wrought iron, black finish, removable linen seat cushions. Each about 110 cm tall, 40 cm wide.\n\nSold as a pair. Suitable for a covered terrace.",
    images: [
      {
        src: "/shop/sun-and-moon-iron-chairs.webp",
        alt: "Two black wrought iron chairs with a moon and a sun cut into their tall backs, white round cushions",
        width: 720,
        height: 864,
      },
    ],
    createdAt: "2026-04-22",
  },
  {
    slug: "linen-silhouette-lantern",
    brand: "Atelier",
    name: "Linen silhouette lantern",
    price: { amount: 29000, currency: "EUR" },
    description:
      "A lantern of linen panels cut into faces, birds and leaves, hung from a wavy metal ring. Lit from inside, the outlines appear on the walls.",
    details:
      "Stiffened linen panels with embroidered outlines, on a painted steel ring with hooks. About 35 cm across, 40 cm tall.\n\nPendant fitting, bulb included. Dust with a soft brush.",
    images: [
      {
        src: "/shop/linen-silhouette-lantern.webp",
        alt: "Lit lantern of hanging linen panels cut into a face and a bird, on a wavy metal ring",
        width: 1112,
        height: 1200,
      },
    ],
    createdAt: "2026-04-03",
  },
  {
    slug: "cast-bronze-chair",
    brand: "Atelier",
    name: "Cast bronze chair",
    price: { amount: 240000, currency: "EUR" },
    description:
      "A chair cast in one piece of bronze, part polished to a mirror and part left rough from the mould. Heavy, warm and unlike anything else.",
    details:
      "Solid cast bronze, hand-polished seat and back, textured legs. About 78 cm tall, 45 cm wide, roughly 40 kg.\n\nOne of a small edition. Delivery by arrangement.",
    images: [
      {
        src: "/shop/cast-bronze-chair.webp",
        alt: "Polished cast bronze chair with a curved back and rough textured legs on a pale floor",
        width: 675,
        height: 1200,
      },
    ],
    createdAt: "2026-03-18",
  },
].map(toProduct);

assertUniqueProductSlugs(products);

export const allProducts: Product[] = products;

export function getProductBySlug(slug: string): Product | undefined {
  return allProducts.find((product) => product.slug === slug);
}
