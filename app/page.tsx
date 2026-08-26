"use client";

/* ============================================================================
   SELORA.

   One shot, fourteen seconds, and then a blue sky with a heading on it.

   The browser opens onto perfect black — no preloader, no transition into
   black, black is simply the page. Stars are already there. A small dark Earth
   is already in that space. The camera travels, the planet grows because the
   camera is closer, the stars wash out because the air in front of them starts
   scattering, clouds grow because the altitude is falling, and the blue that
   fills the frame at the end is the physical end state of the same shot rather
   than a second background.

   There is nothing below it. That is the whole scope: not a page with a
   cinematic at the top, a cinematic that happens to be delivered by a page.
   ========================================================================== */

import dynamic from "next/dynamic";
import Header from "@/components/layout/Header";

// the canvas has no server-rendered form, and the first paint is black anyway
const OpeningCinematic = dynamic(
  () => import("@/components/cinematic/OpeningCinematic"),
  { ssr: false }
);

export default function Page() {
  return (
    <>
      <OpeningCinematic />
      <Header />
    </>
  );
}
