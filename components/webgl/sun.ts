import * as THREE from "three";

/**
 * One sun for the whole site.
 *
 * The surface, the weather shell and the air are lit from one direction, and
 * that is not a detail: inconsistent light is the loudest tell there is in a
 * synthetic image, and it is most of what made the previous planet read as
 * generated. The terminator therefore falls on the left through the approach,
 * and the ocean's glint sits up and to the right of it — one light, one
 * photograph.
 */
export const SUN = new THREE.Vector3(0.62, 0.26, 0.74).normalize();
