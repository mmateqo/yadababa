/* ============================================================================
   SELORA — asset manifest.

   Every path the film uses is declared here once. These files are generated
   locally (see /tools) and are STAND-INS for commissioned photography —
   ASSETS.md specifies the crop, resolution and content required of each
   production plate that replaces them.

   v6 note. The site is one fourteen-second shot and nothing else, so this list
   is short: the planet's five maps, and nine cloud cutouts of which the film
   draws three. There is no preload manifest any more — there is no preloader.
   The first second and a half of black IS the load, and the planet's reveal
   waits on the GPU (lib/ready.ts) rather than on a list.

   Gone with v6: the star plate (the field is geometry now), the island's sand
   and its models, and every full-frame photographic sky.
   ========================================================================== */

export const TEX = {
  /* NASA Blue Marble Next Generation and GEBCO, public domain. See ASSETS.md
     for provenance and tools/gen-earth-v5.mjs for how they were prepared. */
  earth: {
    albedo: "/textures/earth/albedo.webp",
    albedoLo: "/textures/earth/albedo-lo.webp",
    clouds: "/textures/earth/clouds.webp",
    ocean: "/textures/earth/ocean.webp",
    normal: "/textures/earth/normal.webp",
    night: "/textures/earth/night.webp",
  },
  /* Nine clouds in three depth classes; the transition draws far3, mid2 and
     near1. A cloud is an object with a silhouette, not a screen — see the note
     at the top of tools/gen-cloud-objects.mjs. They carry no grain: the plates
     were re-grained at output size until v6, and at the magnification the last
     two seconds put them under, a 9/255 emulsion reads as digital noise over
     the one frame the site is asking to be looked at. */
  clouds: {
    far1: "/textures/clouds/obj-far-1.webp",
    far2: "/textures/clouds/obj-far-2.webp",
    far3: "/textures/clouds/obj-far-3.webp",
    mid1: "/textures/clouds/obj-mid-1.webp",
    mid2: "/textures/clouds/obj-mid-2.webp",
    mid3: "/textures/clouds/obj-mid-3.webp",
    near1: "/textures/clouds/obj-near-1.webp",
    near2: "/textures/clouds/obj-near-2.webp",
    near3: "/textures/clouds/obj-near-3.webp",
  },
} as const;
