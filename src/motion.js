import * as THREE from 'three';
import { CONFIG } from './config.js';

// DVD-screensaver motion: constant speed, straight lines, perfect reflections
// off the viewport edges. The orb rolls without slipping, so its spin axis is
// perpendicular to its velocity and it turns by |v| dt / r each frame.

export class Motion {
  constructor() {
    this.position = new THREE.Vector2(0, 0);
    this.velocity = new THREE.Vector2(...CONFIG.initialDirection).normalize();
    this.direction = this.velocity.clone(); // smoothed heading for the gradient
    this.quaternion = new THREE.Quaternion();
    this.radius = 0.3;
    this.halfWidth = 1;
    this.halfHeight = 1;
    this.speed = CONFIG.speed * 2; // world height is 2 units
    this.onBounce = null;
    this._axis = new THREE.Vector3();
    this._dq = new THREE.Quaternion();
  }

  setBounds(halfWidth, halfHeight, radius) {
    this.halfWidth = halfWidth;
    this.halfHeight = halfHeight;
    this.radius = radius;
    this.clamp();
  }

  clamp() {
    const mx = Math.max(0, this.halfWidth - this.radius);
    const my = Math.max(0, this.halfHeight - this.radius);
    this.position.x = THREE.MathUtils.clamp(this.position.x, -mx, mx);
    this.position.y = THREE.MathUtils.clamp(this.position.y, -my, my);
  }

  update(dt) {
    const speed = this.speed;
    const v = this.velocity;
    const p = this.position;

    p.x += v.x * speed * dt;
    p.y += v.y * speed * dt;

    const mx = Math.max(0, this.halfWidth - this.radius);
    const my = Math.max(0, this.halfHeight - this.radius);
    let hitX = false;
    let hitY = false;
    if (p.x > mx) { p.x = 2 * mx - p.x; v.x = -Math.abs(v.x); hitX = true; }
    else if (p.x < -mx) { p.x = -2 * mx - p.x; v.x = Math.abs(v.x); hitX = true; }
    if (p.y > my) { p.y = 2 * my - p.y; v.y = -Math.abs(v.y); hitY = true; }
    else if (p.y < -my) { p.y = -2 * my - p.y; v.y = Math.abs(v.y); hitY = true; }
    if ((hitX || hitY) && this.onBounce) this.onBounce(hitX && hitY);

    // Rolling: spin about z x v by the distance travelled over the radius.
    const angle = (speed * dt) / this.radius;
    this._axis.set(-v.y, v.x, 0).normalize();
    this._dq.setFromAxisAngle(this._axis, angle);
    this.quaternion.premultiply(this._dq).normalize();

    // Ease the gradient heading toward the new velocity after a bounce by
    // rotating it through the signed angle between them. A corner hit is an
    // exact reversal, which a vector lerp would never resolve.
    const k = 1 - Math.exp(-dt / CONFIG.directionSmoothing);
    const a0 = Math.atan2(this.direction.y, this.direction.x);
    const a1 = Math.atan2(v.y, v.x);
    let da = a1 - a0;
    da = Math.atan2(Math.sin(da), Math.cos(da));
    const a = a0 + da * k;
    this.direction.set(Math.cos(a), Math.sin(a));
  }
}

