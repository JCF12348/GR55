// Ported from: https://e-paper-display.cn/usb2epd.html

// 固定的六色调色板
const rgbPalette = [
  { name: "黄色", r: 255, g: 255, b: 0, value: 0xe2 },
  { name: "绿色", r: 41, g: 204, b: 20, value: 0x96 },
  { name: "蓝色", r: 0, g: 0, b: 255, value: 0x1d },
  { name: "红色", r: 255, g: 0, b: 0, value: 0x4c },
  { name: "黑色", r: 0, g: 0, b: 0, value: 0x00 },
  { name: "白色", r: 255, g: 255, b: 255, value: 0xff }
];

// 四色调色板
const fourColorPalette = [
  { name: "黑色", r: 0, g: 0, b: 0, value: 0x00 },
  { name: "白色", r: 255, g: 255, b: 255, value: 0x01 },
  { name: "红色", r: 255, g: 0, b: 0, value: 0x03 },
  { name: "黄色", r: 255, g: 255, b: 0, value: 0x02 }
];

// 三色调色板
const threeColorPalette = [
  { name: "黑色", r: 0, g: 0, b: 0, value: 0x00 },
  { name: "白色", r: 255, g: 255, b: 255, value: 0x01 },
  { name: "红色", r: 255, g: 0, b: 0, value: 0x02 }
];

const blackWhitePalette = [
  { name: "黑色", r: 0, g: 0, b: 0, value: 0x00 },
  { name: "白色", r: 255, g: 255, b: 255, value: 0x01 }
];

// ACeP display colors adapted from paperlesspaper/epdoptimize (Apache-2.0).
// Dithering and preview use calibrated RGB. The native nibble remains the
// Waveshare transfer contract and is applied only after quantization.
const sevenColorPalette = [
  { name: "Black",  r: 25,  g: 30,  b: 33,  value: 0x00 },
  { name: "White",  r: 241, g: 241, b: 241, value: 0x01 },
  { name: "Green",  r: 83,  g: 164, b: 40,  value: 0x02 },
  { name: "Blue",   r: 49,  g: 49,  b: 143, value: 0x03 },
  { name: "Red",    r: 210, g: 14,  b: 19,  value: 0x04 },
  { name: "Yellow", r: 243, g: 207, b: 17,  value: 0x05 },
  { name: "Orange", r: 184, g: 94,  b: 28,  value: 0x06 }
];

// No-dither chooses one ink from ideal input colors, then previews that ink
// with the calibrated panel color above.
const sevenColorNoDitherPalette = [
  { r: 0,   g: 0,   b: 0,   output: sevenColorPalette[0] },
  { r: 255, g: 255, b: 255, output: sevenColorPalette[1] },
  { r: 0,   g: 255, b: 0,   output: sevenColorPalette[2] },
  { r: 0,   g: 0,   b: 255, output: sevenColorPalette[3] },
  { r: 255, g: 0,   b: 0,   output: sevenColorPalette[4] },
  { r: 255, g: 255, b: 0,   output: sevenColorPalette[5] },
  { r: 255, g: 160, b: 0,   output: sevenColorPalette[6] }
];

const sevenColorNeutralChroma = 14;
const sevenColorCoolNeutralChroma = 22;
const sevenColorGamutMappingStrength = 0.7;

const sevenColorChromaticPalette = sevenColorPalette.slice(2).map(color => ({
  color,
  hue: getSevenColorHue(color.r, color.g, color.b),
  luminance: getSevenColorLuminance(color.r, color.g, color.b)
})).sort((left, right) => left.hue - right.hue);

const paletteLabCache = new Map();

function clampChannel(value) {
  return Math.min(255, Math.max(0, Math.round(value)));
}

function clampDitherError(value) {
  return Math.max(-96, Math.min(96, value));
}

function normalizeDitherStrength(strength) {
  const raw = Math.max(0, Math.min(5, Number(strength) || 0));
  if (raw <= 1) return raw;
  return 1 + 0.45 * (1 - Math.exp(-(raw - 1) / 1.8));
}

function adjustContrast(imageData, factor) {
  const data = imageData.data;
  for (let i = 0; i < data.length; i += 4) {
    data[i] = clampChannel((data[i] - 128) * factor + 128);
    data[i + 1] = clampChannel((data[i + 1] - 128) * factor + 128);
    data[i + 2] = clampChannel((data[i + 2] - 128) * factor + 128);
  }
  return imageData;
}

function adjustBrightnessSaturation(imageData, brightness, saturation) {
  const data = imageData.data;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const luminance = 0.299 * r + 0.587 * g + 0.114 * b;

    data[i] = clampChannel(luminance + (r - luminance) * saturation + brightness);
    data[i + 1] = clampChannel(luminance + (g - luminance) * saturation + brightness);
    data[i + 2] = clampChannel(luminance + (b - luminance) * saturation + brightness);
  }
  return imageData;
}

function rgbToLab(r, g, b) {
  r = r / 255;
  g = g / 255;
  b = b / 255;

  r = r > 0.04045 ? Math.pow((r + 0.055) / 1.055, 2.4) : r / 12.92;
  g = g > 0.04045 ? Math.pow((g + 0.055) / 1.055, 2.4) : g / 12.92;
  b = b > 0.04045 ? Math.pow((b + 0.055) / 1.055, 2.4) : b / 12.92;

  r *= 100;
  g *= 100;
  b *= 100;

  let x = r * 0.4124 + g * 0.3576 + b * 0.1805;
  let y = r * 0.2126 + g * 0.7152 + b * 0.0722;
  let z = r * 0.0193 + g * 0.1192 + b * 0.9505;

  x /= 95.047;
  y /= 100.0;
  z /= 108.883;

  x = x > 0.008856 ? Math.pow(x, 1 / 3) : (7.787 * x) + (16 / 116);
  y = y > 0.008856 ? Math.pow(y, 1 / 3) : (7.787 * y) + (16 / 116);
  z = z > 0.008856 ? Math.pow(z, 1 / 3) : (7.787 * z) + (16 / 116);

  const l = (116 * y) - 16;
  const a = 500 * (x - y);
  const bLab = 200 * (y - z);

  return { l, a, b: bLab };
}

function labDistance(lab1, lab2) {
  const dl = lab1.l - lab2.l;
  const da = lab1.a - lab2.a;
  const db = lab1.b - lab2.b;
  return Math.sqrt(0.35 * dl * dl + 2.2 * da * da + 2.2 * db * db);
}

function getPalette(mode) {
  if (mode === 'sevenColor') {
    return sevenColorPalette;
  } else if (mode === 'fourColor') {
    return fourColorPalette;
  } else if (mode === 'threeColor') {
    return threeColorPalette;
  } else if (mode === 'blackWhiteColor') {
    return blackWhitePalette;
  }
  return rgbPalette;
}

function getPaletteLab(mode) {
  if (!paletteLabCache.has(mode)) {
    paletteLabCache.set(mode, getPalette(mode).map(color => ({ color, lab: rgbToLab(color.r, color.g, color.b) })));
  }
  return paletteLabCache.get(mode);
}

function isSevenColorNeutral(r, g, b) {
  const lab = rgbToLab(r, g, b);
  const chroma = Math.sqrt(lab.a * lab.a + lab.b * lab.b);
  if (chroma <= sevenColorNeutralChroma) return true;

  const hue = getSevenColorHue(r, g, b);
  return lab.l >= 45 && chroma <= sevenColorCoolNeutralChroma && hue >= 175 && hue <= 230;
}

function getSevenColorLuminance(r, g, b) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function getSevenColorHue(r, g, b) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  if (delta === 0) return 0;

  let hue;
  if (max === r) hue = 60 * (((g - b) / delta) % 6);
  else if (max === g) hue = 60 * ((b - r) / delta + 2);
  else hue = 60 * ((r - g) / delta + 4);
  return hue < 0 ? hue + 360 : hue;
}

function findSevenColorHueNeighbors(targetHue) {
  for (let index = 0; index < sevenColorChromaticPalette.length; index++) {
    const left = sevenColorChromaticPalette[index];
    const right = sevenColorChromaticPalette[(index + 1) % sevenColorChromaticPalette.length];
    const span = (right.hue - left.hue + 360) % 360;
    const offset = (targetHue - left.hue + 360) % 360;
    if (offset <= span) return { left, right, position: span === 0 ? 0 : offset / span };
  }
  return {
    left: sevenColorChromaticPalette[0],
    right: sevenColorChromaticPalette[0],
    position: 0
  };
}

function mapSevenColorToDeviceGamut(r, g, b, sourceR, sourceG, sourceB) {
  if (isSevenColorNeutral(sourceR, sourceG, sourceB)) return { r, g, b };

  const neighbors = findSevenColorHueNeighbors(getSevenColorHue(sourceR, sourceG, sourceB));
  const position = neighbors.position * neighbors.position * (3 - 2 * neighbors.position);
  const inverse = 1 - position;
  const baseR = neighbors.left.color.r * inverse + neighbors.right.color.r * position;
  const baseG = neighbors.left.color.g * inverse + neighbors.right.color.g * position;
  const baseB = neighbors.left.color.b * inverse + neighbors.right.color.b * position;
  const baseLuminance = neighbors.left.luminance * inverse + neighbors.right.luminance * position;
  const targetLuminance = getSevenColorLuminance(r, g, b);
  const neutral = targetLuminance >= baseLuminance ? sevenColorPalette[1] : sevenColorPalette[0];
  const neutralLuminance = getSevenColorLuminance(neutral.r, neutral.g, neutral.b);
  const range = neutralLuminance - baseLuminance;
  const amount = Math.abs(range) > 0.001
    ? Math.min(1, Math.max(0, (targetLuminance - baseLuminance) / range))
    : 0;

  return {
    r: baseR + (neutral.r - baseR) * amount,
    g: baseG + (neutral.g - baseG) * amount,
    b: baseB + (neutral.b - baseB) * amount
  };
}

function findClosestSevenColor(r, g, b, sourceR = r, sourceG = g, sourceB = b) {
  let closest = sevenColorPalette[0];
  let minDistance = Infinity;
  const paletteLength = isSevenColorNeutral(sourceR, sourceG, sourceB)
    ? 2
    : sevenColorPalette.length;
  for (let index = 0; index < paletteLength; index++) {
    const color = sevenColorPalette[index];
    if (color.r === r && color.g === g && color.b === b) return color;
    const dr = r - color.r;
    const dg = g - color.g;
    const db = b - color.b;
    const distance = dr * dr + dg * dg + db * db;
    if (distance < minDistance) {
      minDistance = distance;
      closest = color;
    }
  }
  return closest;
}

function findClosestSevenColorNoDither(r, g, b) {
  for (const color of sevenColorPalette) {
    if (color.r === r && color.g === g && color.b === b) return color;
  }

  let closest = sevenColorNoDitherPalette[0];
  let minDistance = Infinity;
  for (const color of sevenColorNoDitherPalette) {
    const dr = r - color.r;
    const dg = g - color.g;
    const db = b - color.b;
    const distance = dr * dr + dg * dg + db * db;
    if (distance < minDistance) {
      minDistance = distance;
      closest = color;
    }
  }
  return closest.output;
}

function findClosestColor(r, g, b, mode) {
  r = clampChannel(r);
  g = clampChannel(g);
  b = clampChannel(b);
  const luminance = 0.299 * r + 0.587 * g + 0.114 * b;

  // Seven-color matching uses calibrated ink appearance; transfer RGB stays native.
  if (mode === 'sevenColor') return findClosestSevenColor(r, g, b);
  if (mode !== 'sevenColor' && mode !== 'fourColor' && mode !== 'threeColor' && r < 50 && g < 150 && b > 100) {
    return rgbPalette[2]; // 蓝色
  }

  // 三色模式下优先检测红色
  if (mode === 'threeColor') {
    if (r > 125 && r > g * 1.28 && r > b * 1.28 && r - Math.max(g, b) > 32) {
      return threeColorPalette[2]; // 红色
    }
    return luminance < 128 ? threeColorPalette[0] : threeColorPalette[1]; // 黑色或白色
  }

  if (mode === 'fourColor') {
    const chroma = Math.max(r, g, b) - Math.min(r, g, b);
    if (r > 135 && r > g * 1.2 && r > b * 1.35 && chroma > 48) return fourColorPalette[2];
    if (r > 145 && g > 120 && b < 105 && Math.abs(r - g) < 95) return fourColorPalette[3];
  }

  if (mode === 'blackWhiteColor') {
    return luminance < 132 ? blackWhitePalette[0] : blackWhitePalette[1];
  }

  const inputLab = rgbToLab(r, g, b);
  let minDistance = Infinity;
  let closestColor = getPalette(mode)[0];

  for (const item of getPaletteLab(mode)) {
    const distance = labDistance(inputLab, item.lab);
    if (distance < minDistance) {
      minDistance = distance;
      closestColor = item.color;
    }
  }

  return closestColor;
}

function addError(tempData, idx, errR, errG, errB, weight) {
  tempData[idx] = clampChannel(tempData[idx] + clampDitherError(errR * weight));
  tempData[idx + 1] = clampChannel(tempData[idx + 1] + clampDitherError(errG * weight));
  tempData[idx + 2] = clampChannel(tempData[idx + 2] + clampDitherError(errB * weight));
}

function floydSteinbergDither(imageData, strength, mode) {
  const width = imageData.width;
  const height = imageData.height;
  const data = imageData.data;
  const tempData = new Uint8ClampedArray(data);

  for (let y = 0; y < height; y++) {
    const leftToRight = (y % 2) === 0;
    const start = leftToRight ? 0 : width - 1;
    const end = leftToRight ? width : -1;
    const step = leftToRight ? 1 : -1;

    for (let x = start; x !== end; x += step) {
      const idx = (y * width + x) * 4;
      const r = tempData[idx];
      const g = tempData[idx + 1];
      const b = tempData[idx + 2];

      const closest = findClosestColor(r, g, b, mode);

      const errR = clampDitherError((r - closest.r) * strength);
      const errG = clampDitherError((g - closest.g) * strength);
      const errB = clampDitherError((b - closest.b) * strength);

      data[idx] = closest.r;
      data[idx + 1] = closest.g;
      data[idx + 2] = closest.b;

      const nextX = x + step;
      if (nextX >= 0 && nextX < width) {
        addError(tempData, idx + step * 4, errR, errG, errB, 7 / 16);
      }
      if (y + 1 < height) {
        const idxDown = idx + width * 4;
        const downPrevX = x - step;
        if (downPrevX >= 0 && downPrevX < width) {
          addError(tempData, idxDown - step * 4, errR, errG, errB, 3 / 16);
        }
        addError(tempData, idxDown, errR, errG, errB, 5 / 16);
        const downNextX = x + step;
        if (downNextX >= 0 && downNextX < width) {
          addError(tempData, idxDown + step * 4, errR, errG, errB, 1 / 16);
        }
      }
    }
  }

  return imageData;
}

function atkinsonDither(imageData, strength, mode) {
  const width = imageData.width;
  const height = imageData.height;
  const data = imageData.data;
  const tempData = new Uint8ClampedArray(data);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const r = tempData[idx];
      const g = tempData[idx + 1];
      const b = tempData[idx + 2];

      const closest = findClosestColor(r, g, b, mode);

      data[idx] = closest.r;
      data[idx + 1] = closest.g;
      data[idx + 2] = closest.b;

      const errR = clampDitherError((r - closest.r) * strength);
      const errG = clampDitherError((g - closest.g) * strength);
      const errB = clampDitherError((b - closest.b) * strength);

      const fraction = 1 / 8;

      if (x + 1 < width) {
        const idxRight = idx + 4;
        tempData[idxRight] = Math.min(255, Math.max(0, tempData[idxRight] + errR * fraction));
        tempData[idxRight + 1] = Math.min(255, Math.max(0, tempData[idxRight + 1] + errG * fraction));
        tempData[idxRight + 2] = Math.min(255, Math.max(0, tempData[idxRight + 2] + errB * fraction));
      }
      if (x + 2 < width) {
        const idxRight2 = idx + 8;
        tempData[idxRight2] = Math.min(255, Math.max(0, tempData[idxRight2] + errR * fraction));
        tempData[idxRight2 + 1] = Math.min(255, Math.max(0, tempData[idxRight2 + 1] + errG * fraction));
        tempData[idxRight2 + 2] = Math.min(255, Math.max(0, tempData[idxRight2 + 2] + errB * fraction));
      }
      if (y + 1 < height) {
        if (x > 0) {
          const idxDownLeft = idx + width * 4 - 4;
          tempData[idxDownLeft] = Math.min(255, Math.max(0, tempData[idxDownLeft] + errR * fraction));
          tempData[idxDownLeft + 1] = Math.min(255, Math.max(0, tempData[idxDownLeft + 1] + errG * fraction));
          tempData[idxDownLeft + 2] = Math.min(255, Math.max(0, tempData[idxDownLeft + 2] + errB * fraction));
        }
        const idxDown = idx + width * 4;
        tempData[idxDown] = Math.min(255, Math.max(0, tempData[idxDown] + errR * fraction));
        tempData[idxDown + 1] = Math.min(255, Math.max(0, tempData[idxDown + 1] + errG * fraction));
        tempData[idxDown + 2] = Math.min(255, Math.max(0, tempData[idxDown + 2] + errB * fraction));
        if (x + 1 < width) {
          const idxDownRight = idx + width * 4 + 4;
          tempData[idxDownRight] = Math.min(255, Math.max(0, tempData[idxDownRight] + errR * fraction));
          tempData[idxDownRight + 1] = Math.min(255, Math.max(0, tempData[idxDownRight + 1] + errG * fraction));
          tempData[idxDownRight + 2] = Math.min(255, Math.max(0, tempData[idxDownRight + 2] + errB * fraction));
        }
      }
      if (y + 2 < height) {
        const idxDown2 = idx + width * 8;
        tempData[idxDown2] = Math.min(255, Math.max(0, tempData[idxDown2] + errR * fraction));
        tempData[idxDown2 + 1] = Math.min(255, Math.max(0, tempData[idxDown2 + 1] + errG * fraction));
        tempData[idxDown2 + 2] = Math.min(255, Math.max(0, tempData[idxDown2 + 2] + errB * fraction));
      }
    }
  }

  return imageData;
}

function stuckiDither(imageData, strength, mode) {
  // 执行Stucki错误扩散算法以处理图像
  const width = imageData.width;
  const height = imageData.height;
  const data = imageData.data;
  const tempData = new Uint8ClampedArray(data);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const r = tempData[idx];
      const g = tempData[idx + 1];
      const b = tempData[idx + 2];

      const closest = findClosestColor(r, g, b, mode);

      const errR = clampDitherError((r - closest.r) * strength);
      const errG = clampDitherError((g - closest.g) * strength);
      const errB = clampDitherError((b - closest.b) * strength);

      const divisor = 42;

      if (x + 1 < width) {
        const idxRight = idx + 4;
        tempData[idxRight] = Math.min(255, Math.max(0, tempData[idxRight] + errR * 8 / divisor));
        tempData[idxRight + 1] = Math.min(255, Math.max(0, tempData[idxRight + 1] + errG * 8 / divisor));
        tempData[idxRight + 2] = Math.min(255, Math.max(0, tempData[idxRight + 2] + errB * 8 / divisor));
      }
      if (x + 2 < width) {
        const idxRight2 = idx + 8;
        tempData[idxRight2] = Math.min(255, Math.max(0, tempData[idxRight2] + errR * 4 / divisor));
        tempData[idxRight2 + 1] = Math.min(255, Math.max(0, tempData[idxRight2 + 1] + errG * 4 / divisor));
        tempData[idxRight2 + 2] = Math.min(255, Math.max(0, tempData[idxRight2 + 2] + errB * 4 / divisor));
      }
      if (y + 1 < height) {
        if (x > 1) {
          const idxDownLeft2 = idx + width * 4 - 8;
          tempData[idxDownLeft2] = Math.min(255, Math.max(0, tempData[idxDownLeft2] + errR * 2 / divisor));
          tempData[idxDownLeft2 + 1] = Math.min(255, Math.max(0, tempData[idxDownLeft2 + 1] + errG * 2 / divisor));
          tempData[idxDownLeft2 + 2] = Math.min(255, Math.max(0, tempData[idxDownLeft2 + 2] + errB * 2 / divisor));
        }
        if (x > 0) {
          const idxDownLeft = idx + width * 4 - 4;
          tempData[idxDownLeft] = Math.min(255, Math.max(0, tempData[idxDownLeft] + errR * 4 / divisor));
          tempData[idxDownLeft + 1] = Math.min(255, Math.max(0, tempData[idxDownLeft + 1] + errG * 4 / divisor));
          tempData[idxDownLeft + 2] = Math.min(255, Math.max(0, tempData[idxDownLeft + 2] + errB * 4 / divisor));
        }
        const idxDown = idx + width * 4;
        tempData[idxDown] = Math.min(255, Math.max(0, tempData[idxDown] + errR * 8 / divisor));
        tempData[idxDown + 1] = Math.min(255, Math.max(0, tempData[idxDown + 1] + errG * 8 / divisor));
        tempData[idxDown + 2] = Math.min(255, Math.max(0, tempData[idxDown + 2] + errB * 8 / divisor));
        if (x + 1 < width) {
          const idxDownRight1 = idx + width * 4 + 4;
          tempData[idxDownRight1] = Math.min(255, Math.max(0, tempData[idxDownRight1] + errR * 4 / divisor));
          tempData[idxDownRight1 + 1] = Math.min(255, Math.max(0, tempData[idxDownRight1 + 1] + errG * 4 / divisor));
          tempData[idxDownRight1 + 2] = Math.min(255, Math.max(0, tempData[idxDownRight1 + 2] + errB * 4 / divisor));
        }
        if (x + 2 < width) {
          const idxDownRight2 = idx + width * 4 + 8;
          tempData[idxDownRight2] = Math.min(255, Math.max(0, tempData[idxDownRight2] + errR * 2 / divisor));
          tempData[idxDownRight2 + 1] = Math.min(255, Math.max(0, tempData[idxDownRight2 + 1] + errG * 2 / divisor));
          tempData[idxDownRight2 + 2] = Math.min(255, Math.max(0, tempData[idxDownRight2 + 2] + errB * 2 / divisor));
        }
      }
      if (y + 2 < height) {
        if (x > 1) {
          const idxDown2Left2 = idx + width * 8 - 8;
          tempData[idxDown2Left2] = Math.min(255, Math.max(0, tempData[idxDown2Left2] + errR * 1 / divisor));
          tempData[idxDown2Left2 + 1] = Math.min(255, Math.max(0, tempData[idxDown2Left2 + 1] + errG * 1 / divisor));
          tempData[idxDown2Left2 + 2] = Math.min(255, Math.max(0, tempData[idxDown2Left2 + 2] + errB * 1 / divisor));
        }
        if (x > 0) {
          const idxDown2Left = idx + width * 8 - 4;
          tempData[idxDown2Left] = Math.min(255, Math.max(0, tempData[idxDown2Left] + errR * 2 / divisor));
          tempData[idxDown2Left + 1] = Math.min(255, Math.max(0, tempData[idxDown2Left + 1] + errG * 2 / divisor));
          tempData[idxDown2Left + 2] = Math.min(255, Math.max(0, tempData[idxDown2Left + 2] + errB * 2 / divisor));
        }
        const idxDown2 = idx + width * 8;
        tempData[idxDown2] = Math.min(255, Math.max(0, tempData[idxDown2] + errR * 4 / divisor));
        tempData[idxDown2 + 1] = Math.min(255, Math.max(0, tempData[idxDown2 + 1] + errG * 4 / divisor));
        tempData[idxDown2 + 2] = Math.min(255, Math.max(0, tempData[idxDown2 + 2] + errB * 4 / divisor));
        if (x + 1 < width) {
          const idxDown2Right = idx + width * 8 + 4;
          tempData[idxDown2Right] = Math.min(255, Math.max(0, tempData[idxDown2Right] + errR * 2 / divisor));
          tempData[idxDown2Right + 1] = Math.min(255, Math.max(0, tempData[idxDown2Right + 1] + errG * 2 / divisor));
          tempData[idxDown2Right + 2] = Math.min(255, Math.max(0, tempData[idxDown2Right + 2] + errB * 2 / divisor));
        }
        if (x + 2 < width) {
          const idxDown2Right2 = idx + width * 8 + 8;
          tempData[idxDown2Right2] = Math.min(255, Math.max(0, tempData[idxDown2Right2] + errR * 1 / divisor));
          tempData[idxDown2Right2 + 1] = Math.min(255, Math.max(0, tempData[idxDown2Right2 + 1] + errG * 1 / divisor));
          tempData[idxDown2Right2 + 2] = Math.min(255, Math.max(0, tempData[idxDown2Right2 + 2] + errB * 1 / divisor));
        }
      }
    }
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const r = tempData[idx];
      const g = tempData[idx + 1];
      const b = tempData[idx + 2];

      const closest = findClosestColor(r, g, b, mode);
      data[idx] = closest.r;
      data[idx + 1] = closest.g;
      data[idx + 2] = closest.b;
    }
  }

  return imageData;
}

function jarvisDither(imageData, strength, mode) {
  const width = imageData.width;
  const height = imageData.height;
  const data = imageData.data;
  const tempData = new Uint8ClampedArray(data);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const r = tempData[idx];
      const g = tempData[idx + 1];
      const b = tempData[idx + 2];

      const closest = findClosestColor(r, g, b, mode);

      data[idx] = closest.r;
      data[idx + 1] = closest.g;
      data[idx + 2] = closest.b;

      const errR = clampDitherError((r - closest.r) * strength);
      const errG = clampDitherError((g - closest.g) * strength);
      const errB = clampDitherError((b - closest.b) * strength);

      const divisor = 48;

      if (x + 1 < width) {
        const idxRight = idx + 4;
        tempData[idxRight] = Math.min(255, Math.max(0, tempData[idxRight] + errR * 7 / divisor));
        tempData[idxRight + 1] = Math.min(255, Math.max(0, tempData[idxRight + 1] + errG * 7 / divisor));
        tempData[idxRight + 2] = Math.min(255, Math.max(0, tempData[idxRight + 2] + errB * 7 / divisor));
      }
      if (x + 2 < width) {
        const idxRight2 = idx + 8;
        tempData[idxRight2] = Math.min(255, Math.max(0, tempData[idxRight2] + errR * 5 / divisor));
        tempData[idxRight2 + 1] = Math.min(255, Math.max(0, tempData[idxRight2 + 1] + errG * 5 / divisor));
        tempData[idxRight2 + 2] = Math.min(255, Math.max(0, tempData[idxRight2 + 2] + errB * 5 / divisor));
      }
      if (y + 1 < height) {
        if (x > 1) {
          const idxDownLeft2 = idx + width * 4 - 8;
          tempData[idxDownLeft2] = Math.min(255, Math.max(0, tempData[idxDownLeft2] + errR * 3 / divisor));
          tempData[idxDownLeft2 + 1] = Math.min(255, Math.max(0, tempData[idxDownLeft2 + 1] + errG * 3 / divisor));
          tempData[idxDownLeft2 + 2] = Math.min(255, Math.max(0, tempData[idxDownLeft2 + 2] + errB * 3 / divisor));
        }
        if (x > 0) {
          const idxDownLeft = idx + width * 4 - 4;
          tempData[idxDownLeft] = Math.min(255, Math.max(0, tempData[idxDownLeft] + errR * 5 / divisor));
          tempData[idxDownLeft + 1] = Math.min(255, Math.max(0, tempData[idxDownLeft + 1] + errG * 5 / divisor));
          tempData[idxDownLeft + 2] = Math.min(255, Math.max(0, tempData[idxDownLeft + 2] + errB * 5 / divisor));
        }
        const idxDown = idx + width * 4;
        tempData[idxDown] = Math.min(255, Math.max(0, tempData[idxDown] + errR * 7 / divisor));
        tempData[idxDown + 1] = Math.min(255, Math.max(0, tempData[idxDown + 1] + errG * 7 / divisor));
        tempData[idxDown + 2] = Math.min(255, Math.max(0, tempData[idxDown + 2] + errB * 7 / divisor));
        if (x + 1 < width) {
          const idxDownRight = idx + width * 4 + 4;
          tempData[idxDownRight] = Math.min(255, Math.max(0, tempData[idxDownRight] + errR * 5 / divisor));
          tempData[idxDownRight + 1] = Math.min(255, Math.max(0, tempData[idxDownRight + 1] + errG * 5 / divisor));
          tempData[idxDownRight + 2] = Math.min(255, Math.max(0, tempData[idxDownRight + 2] + errB * 5 / divisor));
        }
        if (x + 2 < width) {
          const idxDownRight2 = idx + width * 4 + 8;
          tempData[idxDownRight2] = Math.min(255, Math.max(0, tempData[idxDownRight2] + errR * 3 / divisor));
          tempData[idxDownRight2 + 1] = Math.min(255, Math.max(0, tempData[idxDownRight2 + 1] + errG * 3 / divisor));
          tempData[idxDownRight2 + 2] = Math.min(255, Math.max(0, tempData[idxDownRight2 + 2] + errB * 3 / divisor));
        }
      }
      if (y + 2 < height) {
        if (x > 1) {
          const idxDown2Left2 = idx + width * 8 - 8;
          tempData[idxDown2Left2] = Math.min(255, Math.max(0, tempData[idxDown2Left2] + errR * 1 / divisor));
          tempData[idxDown2Left2 + 1] = Math.min(255, Math.max(0, tempData[idxDown2Left2 + 1] + errG * 1 / divisor));
          tempData[idxDown2Left2 + 2] = Math.min(255, Math.max(0, tempData[idxDown2Left2 + 2] + errB * 1 / divisor));
        }
        if (x > 0) {
          const idxDown2Left = idx + width * 8 - 4;
          tempData[idxDown2Left] = Math.min(255, Math.max(0, tempData[idxDown2Left] + errR * 3 / divisor));
          tempData[idxDown2Left + 1] = Math.min(255, Math.max(0, tempData[idxDown2Left + 1] + errG * 3 / divisor));
          tempData[idxDown2Left + 2] = Math.min(255, Math.max(0, tempData[idxDown2Left + 2] + errB * 3 / divisor));
        }
        const idxDown2 = idx + width * 8;
        tempData[idxDown2] = Math.min(255, Math.max(0, tempData[idxDown2] + errR * 5 / divisor));
        tempData[idxDown2 + 1] = Math.min(255, Math.max(0, tempData[idxDown2 + 1] + errG * 5 / divisor));
        tempData[idxDown2 + 2] = Math.min(255, Math.max(0, tempData[idxDown2 + 2] + errB * 5 / divisor));
        if (x + 1 < width) {
          const idxDown2Right = idx + width * 8 + 4;
          tempData[idxDown2Right] = Math.min(255, Math.max(0, tempData[idxDown2Right] + errR * 3 / divisor));
          tempData[idxDown2Right + 1] = Math.min(255, Math.max(0, tempData[idxDown2Right + 1] + errG * 3 / divisor));
          tempData[idxDown2Right + 2] = Math.min(255, Math.max(0, tempData[idxDown2Right + 2] + errB * 3 / divisor));
        }
        if (x + 2 < width) {
          const idxDown2Right2 = idx + width * 8 + 8;
          tempData[idxDown2Right2] = Math.min(255, Math.max(0, tempData[idxDown2Right2] + errR * 1 / divisor));
          tempData[idxDown2Right2 + 1] = Math.min(255, Math.max(0, tempData[idxDown2Right2 + 1] + errG * 1 / divisor));
          tempData[idxDown2Right2 + 2] = Math.min(255, Math.max(0, tempData[idxDown2Right2 + 2] + errB * 1 / divisor));
        }
      }
    }
  }

  return imageData;
}

function bayerDither(imageData, strength, mode) {
  const width = imageData.width;
  const height = imageData.height;
  const data = imageData.data;

  // 8x8 Bayer matrix (normalized to 0-1 range)
  const bayerMatrix = [
    [0, 32, 8, 40, 2, 34, 10, 42],
    [48, 16, 56, 24, 50, 18, 58, 26],
    [12, 44, 4, 36, 14, 46, 6, 38],
    [60, 28, 52, 20, 62, 30, 54, 22],
    [3, 35, 11, 43, 1, 33, 9, 41],
    [51, 19, 59, 27, 49, 17, 57, 25],
    [15, 47, 7, 39, 13, 45, 5, 37],
    [63, 31, 55, 23, 61, 29, 53, 21]
  ];

  const matrixSize = 8;
  const maxThreshold = 64;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];

      // Get threshold from Bayer matrix
      const matrixX = x % matrixSize;
      const matrixY = y % matrixSize;
      const threshold = (bayerMatrix[matrixY][matrixX] / maxThreshold) * 255;

      const thresholdOffset = clampDitherError((threshold - 127.5) * strength);
      const adjustedR = r + thresholdOffset;
      const adjustedG = g + thresholdOffset;
      const adjustedB = b + thresholdOffset;

      // Clamp values
      const clampedR = Math.min(255, Math.max(0, adjustedR));
      const clampedG = Math.min(255, Math.max(0, adjustedG));
      const clampedB = Math.min(255, Math.max(0, adjustedB));

      // Find closest color in palette
      const closest = findClosestColor(clampedR, clampedG, clampedB, mode);

      data[idx] = closest.r;
      data[idx + 1] = closest.g;
      data[idx + 2] = closest.b;
    }
  }

  return imageData;
}

function luminance709(r, g, b) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function histogramPercentile(histogram, count, percentile) {
  const target = Math.max(0, Math.min(count - 1, Math.round((count - 1) * percentile)));
  let seen = 0;
  for (let value = 0; value < histogram.length; value++) {
    seen += histogram[value];
    if (seen > target) return value;
  }
  return 255;
}

function fitEpdDynamicRange(imageData) {
  const data = imageData.data;
  const histogram = new Uint32Array(256);
  let count = 0;

  for (let index = 0; index < data.length; index += 4) {
    if (data[index + 3] === 0) continue;
    histogram[clampChannel(luminance709(data[index], data[index + 1], data[index + 2]))]++;
    count++;
  }
  if (!count) return imageData;

  const black = histogramPercentile(histogram, count, 0.01);
  const white = histogramPercentile(histogram, count, 0.99);
  const range = white - black;
  if (range < 8) return imageData;

  const strength = range < 160 ? 0.9 : range < 220 ? 0.65 : 0.25;
  for (let index = 0; index < data.length; index += 4) {
    const r = data[index];
    const g = data[index + 1];
    const b = data[index + 2];
    const sourceLuma = luminance709(r, g, b);
    const fittedLuma = Math.max(0, Math.min(255, (sourceLuma - black) * 255 / range));
    const delta = (fittedLuma - sourceLuma) * strength;
    data[index] = clampChannel(r + delta);
    data[index + 1] = clampChannel(g + delta);
    data[index + 2] = clampChannel(b + delta);
  }
  return imageData;
}

function epdOptimizeDither(imageData, strength, mode) {
  fitEpdDynamicRange(imageData);
  return floydSteinbergDither(imageData, strength, mode);
}

const esp32DitherMatrices = Object.freeze({
  'floyd-steinberg': [
    [1, 0, 7 / 16], [-1, 1, 3 / 16], [0, 1, 5 / 16], [1, 1, 1 / 16]
  ],
  atkinson: [
    [1, 0, 1 / 8], [2, 0, 1 / 8], [-1, 1, 1 / 8],
    [0, 1, 1 / 8], [1, 1, 1 / 8], [0, 2, 1 / 8]
  ],
  stucki: [
    [1, 0, 8 / 42], [2, 0, 4 / 42],
    [-2, 1, 2 / 42], [-1, 1, 4 / 42], [0, 1, 8 / 42], [1, 1, 4 / 42], [2, 1, 2 / 42],
    [-2, 2, 1 / 42], [-1, 2, 2 / 42], [0, 2, 4 / 42], [1, 2, 2 / 42], [2, 2, 1 / 42]
  ],
  'jarvis-judice-ninke': [
    [1, 0, 7 / 48], [2, 0, 5 / 48],
    [-2, 1, 3 / 48], [-1, 1, 5 / 48], [0, 1, 7 / 48], [1, 1, 5 / 48], [2, 1, 3 / 48],
    [-2, 2, 1 / 48], [-1, 2, 3 / 48], [0, 2, 5 / 48], [1, 2, 3 / 48], [2, 2, 1 / 48]
  ]
});

const esp32BayerMatrix = Object.freeze([
  [0, 32, 8, 40, 2, 34, 10, 42],
  [48, 16, 56, 24, 50, 18, 58, 26],
  [12, 44, 4, 36, 14, 46, 6, 38],
  [60, 28, 52, 20, 62, 30, 54, 22],
  [3, 35, 11, 43, 1, 33, 9, 41],
  [51, 19, 59, 27, 49, 17, 57, 25],
  [15, 47, 7, 39, 13, 45, 5, 37],
  [63, 31, 55, 23, 61, 29, 53, 21]
]);

function getEsp32Palette(mode) {
  if (mode === 'sevenColor') {
    return sevenColorPalette;
  }
  if (mode === 'sixColor') {
    return [
      { r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 },
      { r: 255, g: 255, b: 0 }, { r: 255, g: 0, b: 0 },
      { r: 0, g: 0, b: 255 }, { r: 0, g: 255, b: 0 }
    ];
  }
  if (mode === 'fourColor') {
    return [
      { r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 },
      { r: 255, g: 255, b: 0 }, { r: 255, g: 0, b: 0 }
    ];
  }
  if (mode === 'threeColor') {
    return [{ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 }, { r: 255, g: 0, b: 0 }];
  }
  return [{ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 }];
}

function findClosestEsp32Color(r, g, b, palette, mode, sourceR = r, sourceG = g, sourceB = b) {
  if (mode === 'sevenColor') return findClosestSevenColor(r, g, b, sourceR, sourceG, sourceB);
  let closest = palette[0];
  let minDistance = Infinity;
  for (const color of palette) {
    const dr = r - color.r;
    const dg = g - color.g;
    const db = b - color.b;
    const distance = dr * dr + dg * dg + db * db;
    if (distance < minDistance) {
      minDistance = distance;
      closest = color;
    }
  }
  return closest;
}

function adjustEsp32Color(r, g, b, settings) {
  const brightness = Number.isFinite(settings.brightness) ? settings.brightness : 1;
  const contrast = Number.isFinite(settings.contrast) ? settings.contrast : 1;
  const saturation = Number.isFinite(settings.saturation) ? settings.saturation : 1;
  let adjustedR = (r * brightness - 128) * contrast + 128;
  let adjustedG = (g * brightness - 128) * contrast + 128;
  let adjustedB = (b * brightness - 128) * contrast + 128;
  const average = (adjustedR + adjustedG + adjustedB) / 3;
  adjustedR = average + (adjustedR - average) * saturation;
  adjustedG = average + (adjustedG - average) * saturation;
  adjustedB = average + (adjustedB - average) * saturation;
  return {
    r: Math.min(255, Math.max(0, adjustedR)),
    g: Math.min(255, Math.max(0, adjustedG)),
    b: Math.min(255, Math.max(0, adjustedB))
  };
}

function applyEsp32Adjustments(imageData, settings) {
  const data = imageData.data;
  for (let index = 0; index < data.length; index += 4) {
    const adjusted = adjustEsp32Color(data[index], data[index + 1], data[index + 2], settings);
    data[index] = adjusted.r;
    data[index + 1] = adjusted.g;
    data[index + 2] = adjusted.b;
  }
  return imageData;
}

function esp32DitherImage(
  imageData, algorithm, diffusion, mode, settings,
  adjustmentsApplied = false, sevenColorSourceData = null
) {
  const data = imageData.data;
  const width = imageData.width;
  const height = imageData.height;
  const palette = getEsp32Palette(mode);
  const safeDiffusion = Math.min(1, Math.max(0, Number(diffusion) || 0));
  const useSevenColor = mode === 'sevenColor';
  const sourceData = useSevenColor
    ? (sevenColorSourceData || new Uint8ClampedArray(data))
    : null;
  if (useSevenColor && !adjustmentsApplied) applyEsp32Adjustments(imageData, settings);
  const useSevenColorGamutMapping = useSevenColor && algorithm !== 'none';
  const workingData = useSevenColorGamutMapping ? new Float32Array(data) : data;
  if (useSevenColorGamutMapping) {
    for (let index = 0; index < workingData.length; index += 4) {
      const mapped = mapSevenColorToDeviceGamut(
        workingData[index], workingData[index + 1], workingData[index + 2],
        sourceData[index], sourceData[index + 1], sourceData[index + 2]
      );
      workingData[index] += (mapped.r - workingData[index]) * sevenColorGamutMappingStrength;
      workingData[index + 1] += (mapped.g - workingData[index + 1]) * sevenColorGamutMappingStrength;
      workingData[index + 2] += (mapped.b - workingData[index + 2]) * sevenColorGamutMappingStrength;
    }
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = (y * width + x) * 4;
      const adjusted = adjustmentsApplied || useSevenColor
        ? { r: workingData[index], g: workingData[index + 1], b: workingData[index + 2] }
        : adjustEsp32Color(data[index], data[index + 1], data[index + 2], settings);
      const sourceR = useSevenColor ? sourceData[index] : adjusted.r;
      const sourceG = useSevenColor ? sourceData[index + 1] : adjusted.g;
      const sourceB = useSevenColor ? sourceData[index + 2] : adjusted.b;

      if (algorithm === 'bayer') {
        const threshold = esp32BayerMatrix[y % 8][x % 8] * 255 / 64;
        const gray = 0.299 * adjusted.r + 0.587 * adjusted.g + 0.114 * adjusted.b;
        const offset = (gray - threshold) * safeDiffusion;
        const color = mode === 'blackWhiteColor'
          ? palette[gray >= threshold ? 1 : 0]
          : findClosestEsp32Color(
            adjusted.r + offset, adjusted.g + offset, adjusted.b + offset,
            palette, mode, sourceR, sourceG, sourceB
          );
        data[index] = color.r;
        data[index + 1] = color.g;
        data[index + 2] = color.b;
        continue;
      }

      const color = useSevenColor && algorithm === 'none'
        ? findClosestSevenColorNoDither(adjusted.r, adjusted.g, adjusted.b)
        : findClosestEsp32Color(
          adjusted.r, adjusted.g, adjusted.b, palette, mode, sourceR, sourceG, sourceB
        );
      data[index] = color.r;
      data[index + 1] = color.g;
      data[index + 2] = color.b;
      if (algorithm === 'none') continue;

      const matrix = esp32DitherMatrices[algorithm] || esp32DitherMatrices['floyd-steinberg'];
      const errorR = adjusted.r - color.r;
      const errorG = adjusted.g - color.g;
      const errorB = adjusted.b - color.b;
      for (const [offsetX, offsetY, weight] of matrix) {
        const nextX = x + offsetX;
        const nextY = y + offsetY;
        if (nextX < 0 || nextX >= width || nextY < 0 || nextY >= height) continue;
        const nextIndex = (nextY * width + nextX) * 4;
        const factor = weight * safeDiffusion;
        workingData[nextIndex] += errorR * factor;
        workingData[nextIndex + 1] += errorG * factor;
        workingData[nextIndex + 2] += errorB * factor;
      }
    }
  }
  return imageData;
}

function ditherImage(imageData, alg, strength, mode, adjustments = {}) {
  if (alg === 'epdOptimize') {
    const sourceData = mode === 'sevenColor' ? new Uint8ClampedArray(imageData.data) : null;
    applyEsp32Adjustments(imageData, adjustments);
    if (mode === 'sevenColor') {
      fitEpdDynamicRange(imageData);
      return esp32DitherImage(
        imageData, 'floyd-steinberg', normalizeDitherStrength(strength),
        mode, adjustments, true, sourceData
      );
    }
    return epdOptimizeDither(imageData, normalizeDitherStrength(strength), mode);
  }
  const algorithmAliases = {
    floydSteinberg: 'floyd-steinberg',
    jarvis: 'jarvis-judice-ninke'
  };
  return esp32DitherImage(imageData, algorithmAliases[alg] || alg, strength, mode, adjustments);
}

function decodeProcessedData(processedData, width, height, mode) {
  const imageData = new ImageData(width, height);
  const data = imageData.data;

  if (mode === 'sevenColor') {
    for (let pixel = 0; pixel < width * height; pixel++) {
      const packed = processedData[pixel >> 1];
      const value = (pixel & 1) === 0 ? packed >> 4 : packed & 0x0F;
      const color = sevenColorPalette.find(item => item.value === value) || sevenColorPalette[1];
      const index = pixel * 4;
      data[index] = color.r;
      data[index + 1] = color.g;
      data[index + 2] = color.b;
      data[index + 3] = 255;
    }
  } else if (mode === 'sixColor') {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const newIndex = (x * height) + (height - 1 - y);
        const value = processedData[newIndex];
        const color = rgbPalette.find(c => c.value === value) || rgbPalette[5]; // 默认白色
        const index = (y * width + x) * 4;
        data[index] = color.r;
        data[index + 1] = color.g;
        data[index + 2] = color.b;
        data[index + 3] = 255; // Alpha 透明度
      }
    }
  } else if (mode === 'fourColor') {
    const fourColorValues = [
      { value: 0x00, r: 0, g: 0, b: 0 },      // 黑色
      { value: 0x01, r: 255, g: 255, b: 255 }, // 白色
      { value: 0x03, r: 255, g: 0, b: 0 },     // 红色
      { value: 0x02, r: 255, g: 255, b: 0 }    // 黄色
    ];
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const newIndex = (y * width + x) / 4 | 0;
        const shift = 6 - ((x % 4) * 2);
        const value = (processedData[newIndex] >> shift) & 0x03;
        const color = fourColorValues.find(c => c.value === value) || fourColorValues[1]; // 默认白色
        const index = (y * width + x) * 4;
        data[index] = color.r;
        data[index + 1] = color.g;
        data[index + 2] = color.b;
        data[index + 3] = 255;
      }
    }
  } else if (mode === 'blackWhiteColor') {
    const byteWidth = Math.ceil(width / 8);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const byteIndex = y * byteWidth + Math.floor(x / 8);
        const bitIndex = 7 - (x % 8);
        const bit = (processedData[byteIndex] >> bitIndex) & 1;
        const index = (y * width + x) * 4;
        data[index] = bit ? 255 : 0; // 白或黑
        data[index + 1] = bit ? 255 : 0;
        data[index + 2] = bit ? 255 : 0;
        data[index + 3] = 255;
      }
    }
  } else if (mode === 'threeColor') {
    const byteWidth = Math.ceil(width / 8);
    const blackWhiteData = processedData.slice(0, byteWidth * height);
    const redWhiteData = processedData.slice(byteWidth * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const byteIndex = y * byteWidth + Math.floor(x / 8);
        const bitIndex = 7 - (x % 8);
        const blackWhiteBit = (blackWhiteData[byteIndex] >> bitIndex) & 1;
        const redWhiteBit = (redWhiteData[byteIndex] >> bitIndex) & 1;
        const index = (y * width + x) * 4;
        if (!redWhiteBit) {
          // 红色
          data[index] = 255;
          data[index + 1] = 0;
          data[index + 2] = 0;
        } else {
          // 黑或白
          data[index] = blackWhiteBit ? 255 : 0;
          data[index + 1] = blackWhiteBit ? 255 : 0;
          data[index + 2] = blackWhiteBit ? 255 : 0;
        }
        data[index + 3] = 255;
      }
    }
  }

  return imageData;
}

function processImageData(imageData, mode) {
  const width = imageData.width;
  const height = imageData.height;
  const data = imageData.data;

  let processedData;

  if (mode === 'sevenColor') {
    processedData = new Uint8Array(Math.ceil(width * height / 2));
    for (let pixel = 0; pixel < width * height; pixel++) {
      const index = pixel * 4;
      const closest = findClosestColor(data[index], data[index + 1], data[index + 2], mode);
      processedData[pixel >> 1] |= closest.value << ((pixel & 1) === 0 ? 4 : 0);
    }
  } else if (mode === 'sixColor') {
    processedData = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const index = (y * width + x) * 4;
        const r = data[index];
        const g = data[index + 1];
        const b = data[index + 2];

        const closest = findClosestColor(r, g, b, mode);
        const newIndex = (x * height) + (height - 1 - y);
        processedData[newIndex] = closest.value;
      }
    }
  } else if (mode === 'fourColor') {
    processedData = new Uint8Array(Math.ceil((width * height) / 4));
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const index = (y * width + x) * 4;
        const r = data[index];
        const g = data[index + 1];
        const b = data[index + 2];
        const closest = findClosestColor(r, g, b, mode); // 使用 fourColorPalette
        const colorValue = closest.value; // 0x00 (黑), 0x01 (白), 0x02 (红), 0x03 (黄)
        const newIndex = (y * width + x) / 4 | 0;
        const shift = 6 - ((x % 4) * 2);
        processedData[newIndex] |= (colorValue << shift);
      }
    }
  } else if (mode === 'blackWhiteColor') {
    const byteWidth = Math.ceil(width / 8);
    processedData = new Uint8Array(byteWidth * height);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const index = (y * width + x) * 4;
        const r = data[index];
        const g = data[index + 1];
        const b = data[index + 2];
        const closest = findClosestColor(r, g, b, mode);
        const bit = closest.value;
        const byteIndex = y * byteWidth + Math.floor(x / 8);
        const bitIndex = 7 - (x % 8);
        processedData[byteIndex] |= (bit << bitIndex);
      }
    }
  } else if (mode === 'threeColor') {
    const byteWidth = Math.ceil(width / 8);

    const blackWhiteData = new Uint8Array(height * byteWidth);
    const redWhiteData = new Uint8Array(height * byteWidth);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const index = (y * width + x) * 4;
        const r = data[index];
        const g = data[index + 1];
        const b = data[index + 2];
        const closest = findClosestColor(r, g, b, mode);

        const blackWhiteBit = closest.value === 0x00 ? 0 : 1;
        const blackWhiteByteIndex = y * byteWidth + Math.floor(x / 8);
        const blackWhiteBitIndex = 7 - (x % 8);
        if (blackWhiteBit) {
          blackWhiteData[blackWhiteByteIndex] |= (0x01 << blackWhiteBitIndex);
        } else {
          blackWhiteData[blackWhiteByteIndex] &= ~(0x01 << blackWhiteBitIndex);
        }

        const redWhiteBit = closest.value === 0x02 ? 0 : 1;
        const redWhiteByteIndex = y * byteWidth + Math.floor(x / 8);
        const redWhiteBitIndex = 7 - (x % 8);
        if (redWhiteBit) {
          redWhiteData[redWhiteByteIndex] |= (0x01 << redWhiteBitIndex);
        } else {
          redWhiteData[redWhiteByteIndex] &= ~(0x01 << redWhiteBitIndex);
        }
      }
    }

    processedData = new Uint8Array(blackWhiteData.length + redWhiteData.length);
    processedData.set(blackWhiteData, 0);
    processedData.set(redWhiteData, blackWhiteData.length);
  }

  return processedData;
}
