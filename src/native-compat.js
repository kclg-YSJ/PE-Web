import { WIDTH, HEIGHT } from './core.js';

export const NATIVE_CONTENT_SCALE_FACTOR = Math.min(1024 / WIDTH, 768 / HEIGHT);

export function nativeTextureSize(texture) {
  return {
    width: texture.width / NATIVE_CONTENT_SCALE_FACTOR,
    height: texture.height / NATIVE_CONTENT_SCALE_FACTOR
  };
}
