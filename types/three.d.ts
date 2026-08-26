import type { ThreeElements } from "@react-three/fiber";

/* React 19 moved the JSX namespace onto React; react-three-fiber's element
   types have to be attached there for <mesh/> and friends to typecheck. */
declare global {
  namespace React {
    namespace JSX {
      // eslint-disable-next-line @typescript-eslint/no-empty-object-type -- declaration merging is the only way to attach these
      interface IntrinsicElements extends ThreeElements {}
    }
  }
}

export {};
