'use strict';

// Reconstructed from 图公主 App 2.5.0 Flutter AOT ImageFilters and its APK assets.
const TGZ_FILTERS = Object.freeze([
  ['none', '原图'],
  ['contrastWarm', '反差暖色'],
  ['outdoor', '户外'],
  ['amberFilm', '琥珀映画'],
  ['filmNoirColor', '彩色电影'],
  ['vintageSlide', '反转片'],
  ['iphone4', 'iPhone4'],
  ['coldFilm', '冷白皮'],
  ['nostalgia', '古早风'],
  ['y2k', '千禧风'],
  ['grayscale', '灰度'],
  ['pureBlackWhite', '黑白'],
  ['highContrastBW', '高对比黑白'],
  ['crushBW', '黑白场'],
  ['filmNoir', '黑色电影'],
  ['pencil', '铅笔'],
  ['colorPencil', '彩铅'],
  ['sepia', '棕褐'],
  ['redWhite', '红白'],
  ['blackYellow', '黑黄'],
  ['chrome', '铬黄'],
  ['chromeRed', '铬红'],
  ['redTriTone', '黑白红'],
  ['yellowTriTone', '黑白黄'],
  ['pureRedBlack', '红色调'],
  ['pureYellowBlack', '黄色调'],
  ['color', '彩色']
]);

const tgzFilterRoot = typeof window !== 'undefined' ? window : self;

const tgzFilterTextureCache = new Map();

function tgzFilterClamp(value) {
  return value < 0 ? 0 : value > 255 ? 255 : Math.round(value);
}

function tgzFilterLuma(r, g, b) {
  return Math.round(r * 0.299 + g * 0.587 + b * 0.114);
}

function tgzFilterClone(imageData) {
  return new ImageData(
    new Uint8ClampedArray(imageData.data),
    imageData.width,
    imageData.height
  );
}

function tgzFilterMap(imageData, mapper) {
  const output = tgzFilterClone(imageData);
  const data = output.data;
  for (let offset = 0, pixel = 0; offset < data.length; offset += 4, pixel++) {
    const color = mapper(data[offset], data[offset + 1], data[offset + 2], pixel);
    data[offset] = tgzFilterClamp(color[0]);
    data[offset + 1] = tgzFilterClamp(color[1]);
    data[offset + 2] = tgzFilterClamp(color[2]);
  }
  return output;
}

function tgzFilterContrast(value, factor, midpoint = 127.5) {
  return (value - midpoint) * factor + midpoint;
}

// The App's contrast filters use gamma followed by smoothstep, not a linear
// midpoint stretch. This is reconstructed from ImageFilters' AOT math.
function tgzOfficialSmoothContrast(value, amount) {
  const normalized = Math.max(0, Math.min(1, value / 255));
  const gamma = Math.pow(normalized, 1 / amount);
  return gamma * gamma * (3 - 2 * gamma) * 255;
}

function tgzOfficialClippedGamma(value, low, high, amount) {
  if (value < low) return 0;
  if (value > high) return 255;
  return Math.pow((value - low) / (high - low), 1 / amount) * 255;
}

function tgzFilterSaturate(r, g, b, amount) {
  const gray = tgzFilterLuma(r, g, b);
  return [
    gray + (r - gray) * amount,
    gray + (g - gray) * amount,
    gray + (b - gray) * amount
  ];
}

function tgzOfficialAdjustSaturation(r, g, b, increment = 15) {
  const maximum = Math.max(r, g, b);
  const minimum = Math.min(r, g, b);
  const delta = maximum - minimum;
  const sum = maximum + minimum;
  if (delta === 0) return [r, g, b];

  const lightness = Math.floor(sum / 2);
  const saturation = lightness < 128
    ? Math.trunc(delta * 100 / sum)
    : Math.trunc(delta * 100 / (510 - sum));

  if (increment > 0) {
    const divisor = increment + saturation > 100 ? saturation : 100 - increment;
    const factor = 10000 / divisor - 100;
    return [r, g, b].map(channel => Math.round(channel + (channel - lightness) * factor / 100));
  }

  const factor = 100 + increment;
  return [r, g, b].map(channel => Math.round(lightness + (channel - lightness) * factor / 100));
}

function tgzPreprocessOfficial(imageData) {
  const lut = tgzFilterRoot.TGZ_PREPROCESS_LUT;
  if (!(lut instanceof Uint8Array) || lut.length !== 256) {
    throw new Error('TGZ 官方预处理曲线未加载');
  }
  return tgzFilterMap(imageData, (r, g, b) => {
    const saturated = tgzOfficialAdjustSaturation(r, g, b, 15);
    return [
      lut[tgzFilterClamp(saturated[0])],
      lut[tgzFilterClamp(saturated[1])],
      lut[tgzFilterClamp(saturated[2])]
    ];
  });
}

function tgzFilterBasic(imageData, settings) {
  const brightness = settings.brightness ?? 1;
  const contrast = settings.contrast ?? 1;
  const saturation = settings.saturation ?? 1;
  const red = settings.red ?? 1;
  const green = settings.green ?? 1;
  const blue = settings.blue ?? 1;
  const lift = settings.lift ?? 0;
  const gamma = settings.gamma ?? 1;
  return tgzFilterMap(imageData, (r, g, b) => {
    const saturated = tgzFilterSaturate(r * brightness, g * brightness, b * brightness, saturation);
    const apply = (value, scale) => {
      const contrasted = tgzFilterContrast(value, contrast) * scale + lift;
      return 255 * Math.pow(Math.max(0, contrasted) / 255, gamma);
    };
    return [apply(saturated[0], red), apply(saturated[1], green), apply(saturated[2], blue)];
  });
}

function tgzFilterGrayscale(imageData) {
  return tgzFilterMap(imageData, (r, g, b) => {
    const gray = tgzFilterLuma(r, g, b);
    return [gray, gray, gray];
  });
}

function tgzFilterDuotone(imageData, dark, light) {
  return tgzFilterMap(imageData, (r, g, b) => {
    const amount = tgzFilterLuma(r, g, b) / 255;
    return [
      dark[0] + (light[0] - dark[0]) * amount,
      dark[1] + (light[1] - dark[1]) * amount,
      dark[2] + (light[2] - dark[2]) * amount
    ];
  });
}

function tgzFilterTriTone(imageData, dark, middle, light) {
  return tgzFilterMap(imageData, (r, g, b) => {
    const amount = tgzFilterLuma(r, g, b) / 255;
    const start = amount < 1 / 3 ? dark : amount < 2 / 3 ? middle : light;
    const end = amount < 1 / 3 ? middle : amount < 2 / 3 ? light : light;
    const mix = amount < 1 / 3 ? amount * 3 : amount < 2 / 3 ? (amount - 1 / 3) * 3 : 0;
    return [
      start[0] + (end[0] - start[0]) * mix,
      start[1] + (end[1] - start[1]) * mix,
      start[2] + (end[2] - start[2]) * mix
    ];
  });
}

function tgzFilterPureTwoTone(imageData, first, second, threshold = 128) {
  return tgzFilterMap(imageData, (r, g, b) =>
    tgzFilterLuma(r, g, b) >= threshold ? first : second
  );
}

function tgzApplyContrastWarm(imageData) {
  const lut = tgzFilterRoot.TGZ_CONTRAST_WARM_LUT;
  if (!(lut instanceof Uint8Array) || lut.length !== 768) {
    throw new Error('TGZ 反差暖色曲线未加载');
  }
  return tgzFilterMap(imageData, (r, g, b) => [lut[r] * 1.08, lut[256 + g], lut[512 + b]]);
}

function tgzCubeSample(data, size, r, g, b) {
  const index = ((b * size + g) * size + r) * 3;
  return [data[index], data[index + 1], data[index + 2]];
}

function tgzApplyCubeLut(imageData) {
  const lut = tgzFilterRoot.TGZ_CLASSIC_NEG_LUT;
  if (!lut || lut.size !== 32 || !(lut.data instanceof Float32Array) || lut.data.length !== 98304) {
    throw new Error('TGZ 琥珀映画 LUT 未加载');
  }
  const size = lut.size;
  const max = size - 1;
  return tgzFilterMap(imageData, (r, g, b) => {
    const rx = r / 255 * max;
    const gx = g / 255 * max;
    const bx = b / 255 * max;
    const r0 = Math.floor(rx), g0 = Math.floor(gx), b0 = Math.floor(bx);
    const r1 = Math.min(max, r0 + 1), g1 = Math.min(max, g0 + 1), b1 = Math.min(max, b0 + 1);
    const rf = rx - r0, gf = gx - g0, bf = bx - b0;
    const c000 = tgzCubeSample(lut.data, size, r0, g0, b0);
    const c100 = tgzCubeSample(lut.data, size, r1, g0, b0);
    const c010 = tgzCubeSample(lut.data, size, r0, g1, b0);
    const c110 = tgzCubeSample(lut.data, size, r1, g1, b0);
    const c001 = tgzCubeSample(lut.data, size, r0, g0, b1);
    const c101 = tgzCubeSample(lut.data, size, r1, g0, b1);
    const c011 = tgzCubeSample(lut.data, size, r0, g1, b1);
    const c111 = tgzCubeSample(lut.data, size, r1, g1, b1);
    const result = [0, 0, 0];
    for (let channel = 0; channel < 3; channel++) {
      const c00 = c000[channel] + (c100[channel] - c000[channel]) * rf;
      const c10 = c010[channel] + (c110[channel] - c010[channel]) * rf;
      const c01 = c001[channel] + (c101[channel] - c001[channel]) * rf;
      const c11 = c011[channel] + (c111[channel] - c011[channel]) * rf;
      const c0 = c00 + (c10 - c00) * gf;
      const c1 = c01 + (c11 - c01) * gf;
      result[channel] = (c0 + (c1 - c0) * bf) * 255;
    }
    return result;
  });
}

function tgzFilterBoxBlur(values, width, height, radius) {
  const horizontal = new Float32Array(values.length);
  const output = new Float32Array(values.length);
  for (let y = 0; y < height; y++) {
    let sum = 0;
    for (let x = -radius; x <= radius; x++) sum += values[y * width + Math.max(0, Math.min(width - 1, x))];
    for (let x = 0; x < width; x++) {
      horizontal[y * width + x] = sum / (radius * 2 + 1);
      sum -= values[y * width + Math.max(0, x - radius)];
      sum += values[y * width + Math.min(width - 1, x + radius + 1)];
    }
  }
  for (let x = 0; x < width; x++) {
    let sum = 0;
    for (let y = -radius; y <= radius; y++) sum += horizontal[Math.max(0, Math.min(height - 1, y)) * width + x];
    for (let y = 0; y < height; y++) {
      output[y * width + x] = sum / (radius * 2 + 1);
      sum -= horizontal[Math.max(0, y - radius) * width + x];
      sum += horizontal[Math.min(height - 1, y + radius + 1) * width + x];
    }
  }
  return output;
}

function tgzGaussianBlurImageData(imageData, radius) {
  const width = imageData.width;
  const height = imageData.height;
  const source = imageData.data;
  const output = tgzFilterClone(imageData);
  const horizontal = new Float32Array(source.length);
  const sigma = Math.max(0.5, radius / 2);
  const weights = new Float32Array(radius * 2 + 1);
  let weightTotal = 0;
  for (let offset = -radius; offset <= radius; offset++) {
    const weight = Math.exp(-(offset * offset) / (2 * sigma * sigma));
    weights[offset + radius] = weight;
    weightTotal += weight;
  }
  for (let index = 0; index < weights.length; index++) weights[index] /= weightTotal;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const target = (y * width + x) * 4;
      for (let channel = 0; channel < 3; channel++) {
        let sum = 0;
        for (let offset = -radius; offset <= radius; offset++) {
          const sampleX = Math.max(0, Math.min(width - 1, x + offset));
          sum += source[(y * width + sampleX) * 4 + channel] * weights[offset + radius];
        }
        horizontal[target + channel] = sum;
      }
      horizontal[target + 3] = source[target + 3];
    }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const target = (y * width + x) * 4;
      for (let channel = 0; channel < 3; channel++) {
        let sum = 0;
        for (let offset = -radius; offset <= radius; offset++) {
          const sampleY = Math.max(0, Math.min(height - 1, y + offset));
          sum += horizontal[(sampleY * width + x) * 4 + channel] * weights[offset + radius];
        }
        output.data[target + channel] = tgzFilterClamp(sum);
      }
    }
  }
  return output;
}

function tgzGetTextureData(index, width, height) {
  const image = tgzFilterTextureCache.get(index);
  if (!image || !image.complete || !image.naturalWidth || typeof document === 'undefined') return null;
  try {
    const textureCanvas = document.createElement('canvas');
    textureCanvas.width = width;
    textureCanvas.height = height;
    const textureContext = textureCanvas.getContext('2d', { willReadFrequently: true });
    if (!textureContext) return null;
    textureContext.drawImage(image, 0, 0, width, height);
    return textureContext.getImageData(0, 0, width, height).data;
  } catch (error) {
    return null;
  }
}

function tgzApplyPencil(imageData, keepColor) {
  const width = imageData.width;
  const height = imageData.height;
  const source = imageData.data;
  const gray = new Float32Array(width * height);
  for (let pixel = 0; pixel < gray.length; pixel++) {
    const offset = pixel * 4;
    gray[pixel] = (77 * source[offset] + 150 * source[offset + 1] + 29 * source[offset + 2]) >> 8;
  }
  const blurred = tgzFilterBoxBlur(gray, width, height, 5);
  const darkTexture = tgzGetTextureData(0, width, height);
  const midTexture = tgzGetTextureData(1, width, height);
  return tgzFilterMap(imageData, (r, g, b, pixel) => {
    const blur = Math.round(blurred[pixel]);
    const dodge = blur < 10
      ? 255
      : 255 - Math.max(0, Math.min(255, ((256 - Math.trunc(gray[pixel] * 256 / blur)) * 510) >> 8));
    const textureLuma = texture => texture
      ? (77 * texture[pixel * 4] + 150 * texture[pixel * 4 + 1] + 29 * texture[pixel * 4 + 2]) >> 8
      : dodge;
    let pencil = gray[pixel] < 64
      ? textureLuma(darkTexture)
      : gray[pixel] > 220 ? 255 : textureLuma(midTexture);
    if (dodge < 200) pencil = 0;
    pencil = tgzFilterClamp(pencil);
    if (!keepColor) return [pencil, pencil, pencil];

    const cb = Math.trunc((-169 * r - 331 * g + 500 * b) / 1000) + 128;
    const cr = Math.trunc((500 * r - 419 * g - 81 * b) / 1000) + 128;
    return [
      pencil + ((cr - 128) * 1403 >> 10),
      pencil - ((cb - 128) * 343 >> 10) - ((cr - 128) * 714 >> 10),
      pencil + ((cb - 128) * 1770 >> 10)
    ];
  });
}

function tgzNoise(pixel, seed) {
  let value = (pixel + 1) ^ seed;
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  return ((value ^ (value >>> 16)) >>> 0) / 0xffffffff;
}

function tgzApplyIPhone4(imageData) {
  const blurred = tgzGaussianBlurImageData(imageData, 3);
  return tgzFilterMap(blurred, (r, g, b, pixel) => {
    const noise = (tgzNoise(pixel, 0x34) - 0.5) * 34;
    const adjustedRed = tgzFilterClamp(r * 1.05 + 15);
    const adjustedGreen = tgzFilterClamp(g * 1.02 + 10);
    const adjustedBlue = tgzFilterClamp(b * 0.9);
    return [
      tgzFilterContrast(adjustedRed, 0.85) + 15 + noise,
      tgzFilterContrast(adjustedGreen, 0.85) + 15 + noise,
      tgzFilterContrast(adjustedBlue, 0.85) + 10 + noise
    ];
  });
}

function tgzApplyY2K(imageData) {
  const blurred = tgzGaussianBlurImageData(imageData, 2);
  const width = blurred.width;
  const height = blurred.height;
  const cx = (width - 1) / 2;
  const cy = (height - 1) / 2;
  const maxDistance = Math.sqrt(cx * cx + cy * cy) || 1;
  return tgzFilterMap(blurred, (r, g, b, pixel) => {
    let color = tgzFilterSaturate(r * 1.15, g * 1.15, b * 1.15, 0.85);
    color = color.map(value => (value / 255 * 1.05 - 0.025) * 255);
    color = [color[0] * 0.862745 + 20, color[1] * 0.823529 + 10, color[2] * 0.941176 + 35];
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    const radius = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2) / maxDistance;
    const vignette = 1 - Math.max(0, radius - 0.55) * 0.2;
    const noise = (tgzNoise(pixel, 0x2a) - 0.5) * 15.3;
    return color.map(value => value * vignette + noise);
  });
}

function tgzApplyNostalgia(imageData) {
  return tgzFilterMap(imageData, (r, g, b, pixel) => {
    let color = tgzFilterSaturate(r * 1.05, g * 1.05, b * 1.05, 1.15);
    color = color.map(value => (value / 255 * 1.1 - 0.05) * 255);
    color = [color[0] * 0.862745 + 35, color[1] * 0.843137 + 25, color[2] * 0.764706 + 20];
    const noise = (tgzNoise(pixel, 0x45) - 0.5) * 6;
    return [color[0] * 1.02 + noise, color[1] + noise, color[2] * 1.05 + noise];
  });
}

function tgzApplyColdFilm(imageData) {
  return tgzFilterMap(imageData, (r, g, b) => {
    let color = tgzFilterSaturate(r * 1.05, g * 1.05, b * 1.05, 0.85);
    color = color.map(value => (value / 255 * 1.25 - 0.125) * 255);
    const shadows = tgzFilterLuma(r, g, b) < 160 ? 1 : 0;
    return [color[0] * 0.95, color[1] * 0.95 + 13 * shadows, color[2] + 38 * shadows];
  });
}

function tgzApplyVintageSlide(imageData) {
  return tgzFilterMap(imageData, (r, g, b) => {
    const saturated = tgzFilterSaturate(r, g, b, 1.3);
    return saturated.map(value => tgzOfficialSmoothContrast(value, 1.4));
  });
}

function tgzApplyChrome(imageData, redVariant) {
  return tgzFilterMap(imageData, (r, g, b) => {
    const saturated = tgzFilterSaturate(r, g, b, 1.2);
    const scales = redVariant ? [1, 0.6, 0.5] : [1.1, 1.1, 0.5];
    return saturated.map((value, channel) => tgzOfficialSmoothContrast(value * scales[channel], 1.3));
  });
}

function tgzApplySepia(imageData) {
  return tgzFilterMap(imageData, (r, g, b) => {
    const gray = tgzFilterLuma(r, g, b);
    return [gray * 1.1, gray * 0.9, gray * 0.7];
  });
}

function tgzApplyFilmNoir(imageData, keepColor) {
  return tgzFilterMap(imageData, (r, g, b) => {
    if (keepColor) {
      return [r, g, b].map(value => tgzOfficialClippedGamma(value, 80, 180, 2.5));
    }
    const gray = tgzOfficialClippedGamma(tgzFilterLuma(r, g, b), 80, 180, 2.5);
    return [gray, gray, gray];
  });
}

const tgzFilterImplementations = Object.freeze({
  none: tgzFilterClone,
  outdoor: tgzFilterClone,
  color: imageData => tgzFilterBasic(imageData, { saturation: 1.15 }),
  contrastWarm: tgzApplyContrastWarm,
  amberFilm: tgzApplyCubeLut,
  grayscale: tgzFilterGrayscale,
  highContrastBW: imageData => tgzFilterMap(imageData, (r, g, b) => {
    const gray = tgzOfficialSmoothContrast(tgzFilterLuma(r, g, b), 1.8);
    return [gray, gray, gray];
  }),
  crushBW: imageData => tgzFilterMap(imageData, (r, g, b) => {
    const gray = tgzOfficialClippedGamma(tgzFilterLuma(r, g, b), 40, 210, 1.2);
    return [gray, gray, gray];
  }),
  filmNoir: imageData => tgzApplyFilmNoir(imageData, false),
  filmNoirColor: imageData => tgzApplyFilmNoir(imageData, true),
  pencil: imageData => tgzApplyPencil(imageData, false),
  colorPencil: imageData => tgzApplyPencil(imageData, true),
  sepia: tgzApplySepia,
  vintageSlide: tgzApplyVintageSlide,
  chrome: imageData => tgzApplyChrome(imageData, false),
  chromeRed: imageData => tgzApplyChrome(imageData, true),
  redWhite: imageData => tgzFilterDuotone(imageData, [255, 0, 0], [255, 255, 255]),
  blackYellow: imageData => tgzFilterDuotone(imageData, [0, 0, 0], [255, 255, 0]),
  redTriTone: imageData => tgzFilterTriTone(imageData, [0, 0, 0], [255, 0, 0], [255, 255, 255]),
  yellowTriTone: imageData => tgzFilterTriTone(imageData, [0, 0, 0], [255, 255, 0], [255, 255, 255]),
  pureRedBlack: imageData => tgzFilterPureTwoTone(imageData, [255, 0, 0], [0, 0, 0]),
  pureYellowBlack: imageData => tgzFilterPureTwoTone(imageData, [255, 255, 0], [0, 0, 0]),
  pureBlackWhite: imageData => tgzFilterPureTwoTone(imageData, [255, 255, 255], [0, 0, 0]),
  iphone4: tgzApplyIPhone4,
  coldFilm: tgzApplyColdFilm,
  nostalgia: tgzApplyNostalgia,
  y2k: tgzApplyY2K
});

function applyTgzFilter(imageData, filterId) {
  const implementation = tgzFilterImplementations[filterId] || tgzFilterImplementations.none;
  if (filterId === 'none' || !tgzFilterImplementations[filterId]) {
    return implementation(imageData);
  }
  return implementation(tgzPreprocessOfficial(imageData));
}

function updateTgzOfficialFilterAvailability(mode) {
  if (typeof document === 'undefined') return;
  const select = document.getElementById('tgzFilter');
  if (!select) return;
  const outdoorOption = Array.from(select.options).find(option => option.value === 'outdoor');
  if (!outdoorOption) return;
  outdoorOption.disabled = mode !== 'sixColor';
  outdoorOption.hidden = mode !== 'sixColor';
  if (outdoorOption.disabled && select.value === 'outdoor') select.value = 'none';
}

function preloadTgzFilterTextures() {
  if (typeof Image === 'undefined') return;
  ['assets/tgz-filters/bj01-1.jpg', 'assets/tgz-filters/bj02-1.jpg'].forEach((source, index) => {
    const image = new Image();
    image.decoding = 'async';
    image.addEventListener('load', () => {
      const selectedFilter = typeof document !== 'undefined'
        ? document.getElementById('tgzFilter')?.value
        : 'none';
      if ((selectedFilter === 'pencil' || selectedFilter === 'colorPencil') &&
          typeof applyDither === 'function') {
        applyDither();
      }
    }, { once: true });
    image.src = source;
    tgzFilterTextureCache.set(index, image);
  });
}

preloadTgzFilterTextures();

tgzFilterRoot.TGZ_FILTERS = TGZ_FILTERS;
tgzFilterRoot.applyTgzFilter = applyTgzFilter;
tgzFilterRoot.tgzPreprocessOfficial = tgzPreprocessOfficial;
tgzFilterRoot.updateTgzOfficialFilterAvailability = updateTgzOfficialFilterAvailability;

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { TGZ_FILTERS, applyTgzFilter, tgzPreprocessOfficial };
}
