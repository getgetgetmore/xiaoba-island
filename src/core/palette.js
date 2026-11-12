// 暖柔田园调色板。颜色均为 0xRRGGBB 数值（sRGB 习惯写法）。

export const palette = {
  // 草地
  grassLight: 0xa9d46a,
  grass: 0x86bf5a,
  grassMid: 0x6aa84a,
  grassDark: 0x4f8f3f,
  grassDeep: 0x3d7536,
  lawn: 0xb5db75, // 草坪略亮

  // 土 / 石 / 木
  soil: 0x9a6b45,
  soilLight: 0xb88a5c,
  soilDark: 0x6f4a31,
  stone: 0xb8b2a6,
  stoneLight: 0xd6d0c4,
  stoneDark: 0x8a857c,
  rock: 0x7d7a76,
  wood: 0xb07a4a,
  woodLight: 0xd1a06b,
  woodDark: 0x7a5233,
  trunk: 0x8b5e3c,

  // 狗窝
  roof: 0xc8553d, // 屋顶陶红
  roofDark: 0xa6402c,
  wall: 0xf6e7c8, // 奶油墙
  wallShade: 0xe3cfa8,
  doorInside: 0x4a3426,

  // 树叶
  leaf: 0x7cb85a,
  leafLight: 0x9ccf6b,
  leafDark: 0x5b9c4a,

  // 柴犬
  shibaOrange: 0xe08a3c,
  shibaOrangeDark: 0xc26e2a,
  shibaCream: 0xfaf0dc,
  shibaBlack: 0x2a211d,
  shibaPink: 0xf2a7a0,
  collar: 0xd9443a,
  bell: 0xf2c14e,

  // 花（5 种）
  flowers: [0xf6e36a, 0xf29bb5, 0xffffff, 0xb89be0, 0xf2845c],
  flowerYellow: 0xf6e36a,
  flowerPink: 0xf29bb5,
  flowerWhite: 0xffffff,
  flowerPurple: 0xb89be0,
  flowerOrange: 0xf2845c,
  flowerCenter: 0xf0b83a,

  // 水
  water: 0x7ec8d8,
  waterDeep: 0x4f9fb8,
  waterFoam: 0xd9f1f5,

  // 木棍
  stick: 0xc98f55,

  // 天空（各时段：顶 / 中 / 地平线）
  sky: {
    day: { top: 0x6fb4ea, mid: 0x9fd0f2, horizon: 0xdff0f7 },
    dawn: { top: 0x7f9fd6, mid: 0xf0b6a0, horizon: 0xffd9a8 },
    dusk: { top: 0x5a5fa8, mid: 0xe88f86, horizon: 0xffc27a },
    night: { top: 0x0d1634, mid: 0x1a2a55, horizon: 0x2c3f73 },
    cloudy: { top: 0x9fb0bd, mid: 0xbcc8d0, horizon: 0xd9dfe2 },
    rain: { top: 0x7c8a97, mid: 0x98a5b0, horizon: 0xb4bdc4 },
    storm: { top: 0x4a5461, mid: 0x5f6b78, horizon: 0x77828d },
  },
  sun: 0xfff1c2,
  sunLow: 0xffa860,
  moon: 0xf3f0e0,
  cloud: 0xffffff,
  cloudDusk: 0xffb199,
  cloudStorm: 0x8a929b,
  rainDrop: 0xcfe3ee,

  // 光
  hemiSky: 0xbfe0ff,
  hemiGround: 0x8a7a55,
  moonLight: 0x7f9bd8,

  // 萤火虫 / 灯笼
  firefly: 0xd4f56a,
  fireflyGlow: 0xa8e04a,
  lantern: 0xffc46b,
  lanternGlow: 0xffa940,
};

export default palette;
